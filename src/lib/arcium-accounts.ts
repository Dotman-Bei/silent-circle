/**
 * On-chain decoding utilities for Arcium infrastructure accounts.
 *
 * All byte offsets are documented inline. If arcium-anchor is upgraded,
 * verify the Cluster and MempoolAccount struct layouts against the new
 * source and update accordingly.
 *
 * Reference: arcium-anchor 0.9.6
 */

import { type Connection } from "@solana/web3.js";

import { arciumClusterAccount, arciumMempoolAccount } from "@/lib/arcium-config";
import { solanaConnection } from "@/lib/solana";

type ConnectionLike = Pick<Connection, "getAccountInfo">;

// ---------------------------------------------------------------------------
// Cluster account — stores the MXE cluster's key material.
//
// Borsh layout (arcium-anchor 0.9.6, ClusterAccount):
//   [0..8)   discriminator (8 bytes)
//   [8]      bump: u8 (1 byte)
//   [9..41)  mxe: Pubkey (32 bytes)
//   [41..73) signing_key: [u8; 32]       ← secp256k1 / ed25519 cluster key
//   [73..105) x25519_pubkey: [u8; 32]    ← used for Enc<Shared> key agreement
//
// If the offset is wrong after a crate upgrade, the worst outcome is that
// the MXE will reject the ciphertext and return an error — no silent data
// leakage. Verify with: `solana account <CLUSTER_PUBKEY> --output json`
// and compare bytes [73..105) with `arcium info --cluster devnet`.
// ---------------------------------------------------------------------------
const CLUSTER_X25519_OFFSET = 73; // byte offset of x25519_pubkey in account data
const CLUSTER_X25519_LEN   = 32;

/**
 * Fetch the MXE cluster's X25519 public key from the cluster account on-chain.
 * Returns null if the account does not exist or the data is too short.
 */
export const fetchClusterX25519Pubkey = async (
  connection: ConnectionLike = solanaConnection,
): Promise<Uint8Array | null> => {
  const accountInfo = await connection.getAccountInfo(arciumClusterAccount, "confirmed");

  if (!accountInfo || accountInfo.data.length < CLUSTER_X25519_OFFSET + CLUSTER_X25519_LEN) {
    return null;
  }

  const data = new Uint8Array(accountInfo.data as Buffer);
  return data.slice(CLUSTER_X25519_OFFSET, CLUSTER_X25519_OFFSET + CLUSTER_X25519_LEN);
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
