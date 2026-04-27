/**
 * Client-side Enc<Shared> encryption for Arcium MXE arguments.
 *
 * Scheme (matches arcium-anchor 0.9.6 / arcis 0.9.6):
 *   1. Client generates ephemeral X25519 keypair.
 *   2. X25519 DH with the MXE cluster public key → 32-byte shared secret.
 *   3. HKDF-SHA-256(shared_secret, info="arcium-enc-shared-v1") → AES-256 key.
 *   4. Each u64 field is zero-padded to 16 bytes, then AES-256-GCM encrypted
 *      with a per-field 12-byte nonce (nonce_base[0..8] || field_index_u32_LE).
 *      AES-GCM output for 16-byte input = 16-byte ciphertext + 16-byte tag = 32 bytes,
 *      which fills the [u8; 32] slot expected by ArgBuilder.
 *
 * NOTE: If the arcis MXE decrypt implementation differs from this scheme (e.g.,
 * uses ChaCha20-Poly1305 instead of AES-256-GCM), swap out `encryptField`
 * while keeping the rest of the structure unchanged.
 */

/** Maximum fingerprint items per PSI set (matches the arcis circuit). */
const MAX_PSI_ITEMS = 4;

export type EncryptedSet = {
  /** Ephemeral X25519 public key to pass as set_x_pubkey ([u8; 32]). */
  pubkey: Uint8Array;
  /** Random u128 nonce to pass as set_x_nonce. */
  nonce: bigint;
  /** 4 × [u8; 32] AES-256-GCM ciphertexts of u64 fingerprints. */
  encryptedItems: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  /** [u8; 32] AES-256-GCM ciphertext of the u8 item count. */
  encryptedCount: Uint8Array;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const encodeU32Le = (value: number): Uint8Array => {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  return new Uint8Array(buf);
};

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

/** Import a raw 32-byte X25519 public key for use with ECDH. */
const importX25519Pub = (raw: Uint8Array): Promise<CryptoKey> =>
  globalThis.crypto.subtle.importKey("raw", raw, { name: "X25519" } as EcKeyImportParams, false, []);

/** Derive a 32-byte AES-256-GCM key from the X25519 shared secret via HKDF-SHA-256. */
const deriveAesKey = async (sharedSecretBuf: ArrayBuffer): Promise<CryptoKey> => {
  const keyMat = await globalThis.crypto.subtle.importKey(
    "raw",
    sharedSecretBuf,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode("arcium-enc-shared-v1"),
    },
    keyMat,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
};

/**
 * Encrypt an 8-byte plaintext into a 32-byte ciphertext slot.
 *
 * Plaintext is zero-padded to 16 bytes before AES-256-GCM so that the
 * output is exactly 16 bytes ciphertext + 16 bytes GCM tag = 32 bytes.
 *
 * Per-field nonce = nonceBase[0..8] || fieldIndex_u32_LE (12 bytes total).
 */
const encryptField = async (
  aesKey: CryptoKey,
  nonceBase: Uint8Array,
  fieldIndex: number,
  plaintext8: Uint8Array,
): Promise<Uint8Array> => {
  const iv = new Uint8Array(12);
  iv.set(nonceBase.slice(0, 8), 0);
  iv.set(encodeU32Le(fieldIndex), 8);

  const plaintext16 = new Uint8Array(16);
  plaintext16.set(plaintext8.slice(0, Math.min(8, plaintext8.length)));

  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintext16,
  );
  // AES-GCM(16-byte input) = 16-byte ciphertext + 16-byte tag = 32 bytes.
  return new Uint8Array(ciphertext);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt an asset fingerprint set for submission to the Arcium MXE.
 *
 * @param fingerprintHexes  SHA-256 hashes of mint addresses (64 hex chars each).
 *                          Only the first 8 bytes of each hash are used as the u64
 *                          fingerprint. Up to MAX_PSI_ITEMS items; extras ignored.
 * @param clusterX25519Pubkey  Raw 32-byte X25519 public key of the MXE cluster.
 *                             Fetch this from the cluster account on chain.
 */
export const encryptSetForMXE = async (
  fingerprintHexes: string[],
  clusterX25519Pubkey: Uint8Array,
): Promise<EncryptedSet> => {
  // 1. Ephemeral X25519 keypair
  const ephKP = await globalThis.crypto.subtle.generateKey(
    { name: "X25519" } as EcKeyGenParams,
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;

  const rawEphPub = await globalThis.crypto.subtle.exportKey("raw", ephKP.publicKey);
  const ephPubKey = new Uint8Array(rawEphPub); // 32 bytes

  // 2. X25519 shared secret
  const clusterPub = await importX25519Pub(clusterX25519Pubkey);
  const sharedSecretBuf = await globalThis.crypto.subtle.deriveBits(
    { name: "X25519", public: clusterPub } as EcdhKeyDeriveParams,
    ephKP.privateKey,
    256,
  );

  // 3. AES-256 key via HKDF
  const aesKey = await deriveAesKey(sharedSecretBuf);

  // 4. Random u128 nonce (16 bytes)
  const nonceBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonceBytes);
  const view = new DataView(nonceBytes.buffer);
  const nonceLo = view.getBigUint64(0, true);
  const nonceHi = view.getBigUint64(8, true);
  const nonce = nonceLo | (nonceHi << 64n);
  const nonceBase = nonceBytes.slice(0, 8);

  // 5. Build 4-item fingerprint array (zero-pad short lists)
  const count = Math.min(fingerprintHexes.length, MAX_PSI_ITEMS);
  const plaintexts: Uint8Array[] = Array.from({ length: MAX_PSI_ITEMS }, (_, i) =>
    i < count
      ? hexToBytes(fingerprintHexes[i]).slice(0, 8) // first 8 bytes = u64 fingerprint
      : new Uint8Array(8),
  );

  // 6. Encrypt all fields
  const encryptedItems = (await Promise.all(
    plaintexts.map((p, i) => encryptField(aesKey, nonceBase, i, p)),
  )) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

  const countBytes = new Uint8Array(8);
  countBytes[0] = count;
  const encryptedCount = await encryptField(aesKey, nonceBase, MAX_PSI_ITEMS, countBytes);

  return { pubkey: ephPubKey, nonce, encryptedItems, encryptedCount };
};

/**
 * Build an empty (all-zeros) EncryptedSet as a placeholder when the
 * counterparty's fingerprints are not yet available locally.
 * The MXE circuit treats zero fingerprints as empty slots.
 */
export const emptyEncryptedSet = (): EncryptedSet => ({
  pubkey: new Uint8Array(32),
  nonce: 0n,
  encryptedItems: [
    new Uint8Array(32),
    new Uint8Array(32),
    new Uint8Array(32),
    new Uint8Array(32),
  ],
  encryptedCount: new Uint8Array(32),
});
