/**
 * On-chain decoding utilities for Arcium infrastructure accounts.
 *
 * Reference: arcium-anchor 0.9.7 / @arcium-hq/client 0.9.7
 */

import { type Connection } from "@solana/web3.js";

import { arciumMxeAccount, arciumMempoolAccount } from "@/lib/arcium-config";
import { solanaConnection } from "@/lib/solana";

type ConnectionLike = Pick<Connection, "getAccountInfo">;

// ---------------------------------------------------------------------------
// MXEAccount — contains utility_pubkeys.x25519_pubkey used for Enc<Shared>.
//
// Borsh layout (arcium-anchor 0.9.7, MXEAccount):
//   [0..8)     discriminator
//   [8]        cluster: Option<u32> tag (0=None, 1=Some)
//   if Some:   [9..13) cluster offset u32
//   [+8)       keygen_offset: u64
//   [+8)       key_recovery_init_offset: u64
//   [+32)      mxe_program_id: Pubkey
//   [+1)       authority: Option<Pubkey> tag (0=None, 1=Some)
//   if Some:   [+32) authority Pubkey
//   [+1)       utility_pubkeys: SetUnset tag (0=Unset, 1=Set)
//   if Set:    [+32) x25519_pubkey  ← Enc<Shared> key agreement
//              [+32) ed25519_verifying_key
//              [+32) elgamal_pubkey
//              [+64) elgamal_proof
// ---------------------------------------------------------------------------
const parseMxeX25519 = (raw: Uint8Array): Uint8Array | null => {
  let pos = 8; // skip discriminator

  if (pos >= raw.length) return null;
  const hasCluster = raw[pos] === 1;
  pos += 1;
  if (hasCluster) pos += 4; // u32

  pos += 8; // keygen_offset u64
  pos += 8; // key_recovery_init_offset u64
  pos += 32; // mxe_program_id Pubkey

  if (pos >= raw.length) return null;
  const hasAuthority = raw[pos] === 1;
  pos += 1;
  if (hasAuthority) pos += 32;

  if (pos >= raw.length) return null;
  const isSet = raw[pos] === 1;
  pos += 1;
  if (!isSet) return null;

  if (pos + 32 > raw.length) return null;
  const x25519 = raw.slice(pos, pos + 32);
  return x25519.every(b => b === 0) ? null : x25519;
};

/**
 * Fetch the MXE's X25519 public key from the MXE account on-chain.
 * Returns null if the account is missing or keygen has not yet completed.
 */
export const fetchClusterX25519Pubkey = async (
  connection: ConnectionLike = solanaConnection,
): Promise<Uint8Array | null> => {
  const accountInfo = await connection.getAccountInfo(arciumMxeAccount, "confirmed");
  if (!accountInfo) return null;
  return parseMxeX25519(new Uint8Array(accountInfo.data as Buffer));
};

// ---------------------------------------------------------------------------
// Env-var override: VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX
//
// Set this to the 64-character hex encoding of the cluster X25519 pubkey
// printed by `arcium info --cluster devnet`. Takes priority over on-chain
// fetching when set, which avoids needing a live RPC call during plan build.
// ---------------------------------------------------------------------------
const envX25519Hex = (() => {
  const raw = (import.meta.env as Record<string, string>)["VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX"]?.trim();
  return raw?.length === 64 ? raw : null;
})();

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

/**
 * Return the cluster X25519 pubkey:
 *   1. From VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX env var (instant)
 *   2. Fetched from the cluster account on-chain (async)
 *   3. Returns null if neither is available
 */
export const resolveClusterX25519Pubkey = async (
  connection: ConnectionLike = solanaConnection,
): Promise<Uint8Array | null> => {
  if (envX25519Hex) {
    return hexToBytes(envX25519Hex);
  }
  return fetchClusterX25519Pubkey(connection);
};

// ---------------------------------------------------------------------------
// Mempool account — tracks pending computation slots.
//
// Borsh layout (arcium-anchor 0.9.6, MempoolAccount):
//   [0..8)   discriminator (8 bytes)
//   [8]      bump: u8 (1 byte)
//   [9..41)  mxe: Pubkey (32 bytes)
//   [41..49) computation_count: u64 (little-endian)  ← next available offset
//
// The `computation_offset` argument in start_psi must match an unoccupied
// computation PDA slot. Using `computation_count` from the mempool is the
// canonical way to get the next free slot before signing.
// ---------------------------------------------------------------------------
const MEMPOOL_COMP_COUNT_OFFSET = 41;

/**
 * Fetch the next available computation offset from the Arcium mempool account.
 *
 * This must be called immediately before building and signing the start_psi
 * transaction to avoid a race condition where another computation occupies
 * the same slot between fetch and sign.
 *
 * Falls back to a timestamp-based u64 when the mempool account is unreachable
 * (e.g., Arcium not yet configured), which is still unique but unverified.
 */
export const fetchNextComputationOffset = async (
  connection: ConnectionLike = solanaConnection,
): Promise<bigint> => {
  try {
    const accountInfo = await connection.getAccountInfo(arciumMempoolAccount, "confirmed");

    if (accountInfo && accountInfo.data.length >= MEMPOOL_COMP_COUNT_OFFSET + 8) {
      const data = accountInfo.data as Buffer;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return view.getBigUint64(MEMPOOL_COMP_COUNT_OFFSET, true /* little-endian */);
    }
  } catch {
    // Fall through to timestamp fallback.
  }

  // Fallback: millisecond timestamp — unique across calls but not atomically
  // reserved on-chain. Only safe when Arcium is not yet deployed.
  return BigInt(Date.now());
};
