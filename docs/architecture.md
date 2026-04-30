# SilentCircle — Architecture

This document goes one layer deeper than the README's overview. It covers the
on-chain account layout, the encryption scheme, the full data flow with byte
sizes, and where the trust boundaries sit.

## Three Layers

```
 ┌─────────────────────┐    ┌──────────────────────────┐    ┌─────────────────────┐
 │  Frontend (Vite)    │    │  Solana program (Anchor) │    │  Arcium MXE network │
 │                     │    │                          │    │                     │
 │  src/lib/assets.ts  │    │  programs/silent_circle  │    │  arcium_compute     │
 │   ↓ fetch SPL/NFT/  │    │   declare_id! → 63CgPf…  │    │   compute_psi       │
 │   DAO mints         │    │                          │    │   (garbled circuit) │
 │  src/lib/arcium-    │    │  Session PDA             │    │                     │
 │   encrypt.ts        │    │   wallet_a, wallet_b     │    │   Inputs:           │
 │   ↓ X25519 + HKDF + │    │   commitment_a, _b       │    │     Enc<Shared,Set> │
 │   AES-256-GCM       │    │   asset_mask, expiry     │    │   Output:           │
 │  src/lib/session-   │    │   intersection: Vec      │    │     [u64; 4] signed │
 │   client.ts         │    │                          │    │                     │
 │   ↓ build IX +      │    │  create_session ────────▶│    │                     │
 │   sign with wallet  │    │  commit_set     ────────▶│    │                     │
 │                     │    │  start_psi      ─CPI───▶ │ ──▶│  queued in mempool  │
 │  src/pages/         │    │                          │    │                     │
 │   Index.tsx         │    │  write_intersection ◀──── │ ◀──│  signed callback    │
 │   ↑ poll PDA / 3s   │    │  (verifies sig)          │    │                     │
 │   ↑ resolve names   │    │                          │    │                     │
 │   ↑ render matches  │    │  close_session (rent)    │    │                     │
 └─────────────────────┘    └──────────────────────────┘    └─────────────────────┘
```

The three layers correspond to the three top-level directories in the repo:

- **`src/`** — Vite + React frontend. Sole owner of plaintext mint addresses.
  Encrypts before any data leaves the client.
- **`programs/silent_circle/`** — Anchor program. Owns the Session PDA and is
  the only entity that may write the intersection back, gated by the Arcium
  cluster signature.
- **`arcium_compute/`** — `compute_psi` circuit definition. Compiled by the
  Arcium toolchain and deployed as a computation. Runs on the MXE network's
  garbled circuits — no individual node sees plaintext.

## Session PDA Layout

Seed: `[b"session", session_id]` where `session_id` is `[u8; 8]` generated
client-side via `crypto.getRandomValues` and base58-encoded for the invite URL.

```
offset  field            size  notes
─────── ──────────────── ───── ───────────────────────────────────────────────
0       discriminator    8     Anchor account discriminator
8       wallet_a         32    initiator pubkey
40      wallet_b         32    counterparty pubkey (zero until commit_set)
72      commitment_a     32    sha256 of wallet A's encrypted set fingerprint
104     commitment_b     32    sha256 of wallet B's encrypted set fingerprint
136     arcium_task_id   8     u64 — computation_offset used in start_psi
144     state            1     enum: 0..=4 (Awaiting → BothCommitted → …)
145     asset_mask       1     bitmask: 0b001 tokens, 0b010 NFTs, 0b100 DAOs
146     created_at       8     i64 unix timestamp
154     expires_at       8     i64 unix timestamp (created_at + 24h default)
162     bump             1     PDA bump
163     state_nonce      16    u128 — Arcium MXE state nonce (placed before
                               encrypted_state for stable offset)
─────── ──────────────── ───── ───────────────────────────────────────────────
179     encrypted_state  576   18 × 32-byte ciphertexts (set_a + set_b
                               encrypted u64 fingerprints + count)
755     intersection.len 4     u32 Vec header
759     intersection[i]  32×N  matched fingerprints (max 50 reserved)
```

The byte offset constants are exported from `lib.rs` (`ENCRYPTED_STATE_OFFSET`,
`ENCRYPTED_STATE_LEN`, `SESSION_SPACE`). The frontend deserialises the same
layout in [src/lib/session-account.ts](../src/lib/session-account.ts).

## Encryption Scheme (Frontend → MXE)

For each wallet, [src/lib/arcium-encrypt.ts](../src/lib/arcium-encrypt.ts):

1. Generates an ephemeral X25519 keypair.
2. Performs X25519 ECDH with the MXE cluster's public X25519 key (fetched
   from the cluster account, byte offset 73, or supplied via
   `VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX`).
3. Derives an AES-256-GCM key via HKDF-SHA-256 with `info = "arcium-enc-shared-v1"`.
4. Encrypts each `u64` fingerprint (the first 8 bytes of `sha256(mint)`)
   zero-padded to 16 bytes, with a per-field IV of
   `nonce_base[0..8] || field_index_u32_LE`.
5. Each field comes out at exactly 32 bytes (16-byte ciphertext + 16-byte tag),
   matching the `[u8; 32]` slot the Arcium ArgBuilder expects.

The ephemeral X25519 public key and the random `u128` nonce are passed as
plaintext along with the ciphertexts. The MXE re-derives the same shared
secret inside the garbled circuit and decrypts the inputs there.

## PSI Circuit

[arcium_compute/src/psi.rs](../arcium_compute/src/psi.rs):

```rust
#[instruction]
pub fn compute_psi(set_a: Enc<Shared, SetA>, set_b: Enc<Shared, SetB>) -> [u64; 4] {
    // 4×4 = 16 fixed comparisons. Circuit size is a compile-time constant.
    // Result[i] = a.items[i] if a.items[i] == b.items[j] for any j; else 0.
}
```

The circuit operates entirely on encrypted values until the final `.reveal()`.
The output `[u64; 4]` is the only thing the MXE produces — the underlying sets
themselves are never exposed.

## Trust Boundaries

```
plaintext mints     │  ciphertext slots    │  on-chain commitments
─────────────────── │ ─────────────────── │ ──────────────────────
Wallet A's browser  │  Arcium MXE network │  Solana cluster
Wallet B's browser  │   (garbled circuit) │   (any RPC reader)
```

- **Wallet → ciphertext.** Plaintext mint addresses never leave the wallet's
  browser. Encryption uses the MXE cluster's public key, so only the MXE
  cluster can decrypt — and only inside the garbled circuit, where no
  individual node sees a coherent value.
- **Ciphertext → on-chain.** What's written to the Session PDA is just the
  `sha256` of the ciphertext (the commitment) plus a zero-knowledge encrypted
  blob of the inputs. An RPC reader sees commitments and ciphertext, never
  plaintext mints.
- **MXE → callback.** The MXE signs its `[u64; 4]` output with the cluster
  key. `write_intersection` calls `output.verify_output(...)` against the
  cluster account before persisting the result. A forged callback fails
  verification and the program rejects it.

## Why a Forged Result Can't Slip Through

The callback path is the only way the intersection field on the PDA changes
after `start_psi`. `write_intersection` does three things, in order:

1. Pulls the `SignedComputationOutputs<ComputePsiOutput>` and calls
   `verify_output(&cluster, &computation)`. This recomputes the signature
   against the cluster's signing key. A non-MXE caller can't produce a valid
   signature, and `verify_output` returns `Err`.
2. On success, expands each non-zero `u64` in `field_0` into a `[u8; 32]` —
   the original fingerprint stored in the low 8 bytes, zeros elsewhere.
3. Sets `state = Done` and emits `IntersectionReady { session, count }`.

Step 1 is the trust hinge. The Anchor program never trusts the
`computation_account` based on origin — it always re-verifies the signature.

## Where Names Come Back In

After the intersection lands on-chain, the frontend takes over name resolution
in [src/lib/intersection-matches.ts](../src/lib/intersection-matches.ts):

- It builds a local fingerprint → asset-id map from the *current wallet's*
  asset snapshot. Each row is `(first 8 bytes of sha256(mint), mint)`.
- For each on-chain intersection entry, it looks up the fingerprint in that
  map. A hit means "this match corresponds to one of *my* assets" — the local
  client can therefore name it via Jupiter token list, Metaplex collection
  metadata, or SPL Governance realm data.
- Misses (extremely rare with 8-byte fingerprints over realistic portfolios)
  fall back to a hash-only card.

This is why neither side leaks: names are resolved separately on each side
against the each side's own data. The on-chain payload is fingerprints only.

## Lifetimes

- A session expires `created_at + 24h` by default. After expiry, `commit_set`
  and `start_psi` reject with `SessionExpired`.
- `close_session` reclaims the PDA's rent back to wallet A once the session
  is either `Done`, `Expired`, or past `expires_at`. Only wallet A may call
  it — enforced by the `has_one = wallet_a` constraint.
- Computation accounts on the Arcium side are managed by the Arcium program
  and have their own lifecycle independent of the SilentCircle PDA.
