/**
 * Arcium infrastructure account addresses for the Silent Circle frontend.
 *
 * After deploying the program and registering the MXE, populate your `.env`
 * with the values printed by `arcium info --cluster devnet`.
 *
 * All VITE_ARCIUM_* variables are optional — the fallbacks are placeholder
 * pubkeys that will cause Solana transactions to fail with "account not found"
 * rather than silently sending to a wrong address.
 */

import { PublicKey, SystemProgram } from "@solana/web3.js";

const env = (key: string) => (import.meta.env as Record<string, string>)[key]?.trim() ?? "";

// The Arcium on-chain program (same across all MXE deployments on devnet).
// Obtain from: https://docs.arcium.com/devnet or `arcium info`
const ARCIUM_PROGRAM_ID_RAW = env("VITE_ARCIUM_PROGRAM_ID") || "11111111111111111111111111111111";

// Your registered MXE account address (`arcium register-mxe --cluster devnet`).
const MXE_PUBKEY_RAW = env("VITE_ARCIUM_MXE_PUBKEY") || "11111111111111111111111111111111";

// PDAs derived from the MXE — run `arcium info --cluster devnet` to get these.
const MEMPOOL_RAW   = env("VITE_ARCIUM_MEMPOOL_PUBKEY")   || "11111111111111111111111111111111";
const EXECPOOL_RAW  = env("VITE_ARCIUM_EXECPOOL_PUBKEY")  || "11111111111111111111111111111111";
const CLUSTER_RAW   = env("VITE_ARCIUM_CLUSTER_PUBKEY")   || "11111111111111111111111111111111";
const COMP_DEF_RAW  = env("VITE_ARCIUM_COMP_DEF_PUBKEY")  || "11111111111111111111111111111111";

// Fixed Arcium protocol accounts (same on all devnet deployments).
const FEE_POOL_RAW  = env("VITE_ARCIUM_FEE_POOL_PUBKEY")  || "11111111111111111111111111111111";
const CLOCK_RAW     = env("VITE_ARCIUM_CLOCK_PUBKEY")      || "11111111111111111111111111111111";

// ---------------------------------------------------------------------------
// Exported singletons
// ---------------------------------------------------------------------------

export const arciumProgramId     = new PublicKey(ARCIUM_PROGRAM_ID_RAW);
export const arciumMxeAccount    = new PublicKey(MXE_PUBKEY_RAW);
export const arciumMempoolAccount = new PublicKey(MEMPOOL_RAW);
export const arciumExecpoolAccount = new PublicKey(EXECPOOL_RAW);
export const arciumClusterAccount = new PublicKey(CLUSTER_RAW);
export const arciumCompDefAccount = new PublicKey(COMP_DEF_RAW);
export const arciumFeePoolAccount = new PublicKey(FEE_POOL_RAW);
export const arciumClockAccount   = new PublicKey(CLOCK_RAW);

/**
 * Derive the sign_pda_account address for the Silent Circle program.
 * Seeds: [SIGN_PDA_SEED] with the Silent Circle program ID.
 * SIGN_PDA_SEED = b"arcium_sign_pda" (from arcium-anchor 0.9.6).
 */
export const deriveSignPda = (silentCircleProgramId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("arcium_sign_pda")],
    silentCircleProgramId,
  )[0];

/**
 * Derive the computation account address for a given computation offset.
 * Seeds: ["computation", mxe_key_bytes, computation_offset_le_8_bytes]
 * with the Arcium program ID.
 */
export const deriveComputationAccount = (computationOffset: bigint): PublicKey => {
  const offsetBuf = new ArrayBuffer(8);
  new DataView(offsetBuf).setBigUint64(0, computationOffset, true);
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("computation"),
      arciumMxeAccount.toBytes(),
      new Uint8Array(offsetBuf),
    ],
    arciumProgramId,
  )[0];
};

export const hasArciumConfigured = () =>
  MXE_PUBKEY_RAW !== "11111111111111111111111111111111" &&
  MEMPOOL_RAW    !== "11111111111111111111111111111111";
