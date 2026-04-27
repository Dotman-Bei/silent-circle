import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
  arciumClockAccount,
  arciumClusterAccount,
  arciumCompDefAccount,
  arciumExecpoolAccount,
  arciumFeePoolAccount,
  arciumMempoolAccount,
  arciumMxeAccount,
  arciumProgramId,
  deriveComputationAccount,
  deriveSignPda,
} from "@/lib/arcium-config";
import { emptyEncryptedSet, encryptSetForMXE, type EncryptedSet } from "@/lib/arcium-encrypt";
import type { SessionDraft } from "@/lib/session-draft";
import { decodeSessionId } from "@/lib/session";

const SESSION_SEED = "session";
const PLACEHOLDER_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export type SerializedInstructionAccount = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};

export type SessionInstructionPlan = {
  instructionName: "create_session" | "commit_set" | "start_psi";
  programId: string;
  sessionId: string;
  sessionPda: string;
  signer: string;
  instructionDataHex: string;
  accounts: SerializedInstructionAccount[];
};

type BuildCommitSetPlanInput = {
  sessionId: string;
  signer: string;
  commitmentHex: string;
};

export type StartPsiParams = {
  sessionId: string;
  signer: string;
  /** SHA-256 hashes (hex) of the calling party's own mint addresses (up to 4). */
  ownFingerprintHexes: string[];
  /** True when the signer is wallet_a (the session initiator). */
  isInitiator: boolean;
  /** Raw 32-byte X25519 public key of the MXE cluster, fetched from chain. */
  clusterX25519Pubkey: Uint8Array;
  /**
   * Unique u64 offset for the computation PDA on the Arcium mempool.
   * Fetch from the mempool account before calling start_psi.
   */
  computationOffset: bigint;
};

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hexToBytes = (hex: string) => {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex input must contain an even number of characters.");
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }

  return bytes;
};

const concatBytes = (...chunks: Uint8Array[]) => {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

const encodeI64 = (value: number) => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, BigInt(value), true);
  return new Uint8Array(buffer);
};

const encodeU64 = (value: bigint) => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, value, true);
  return new Uint8Array(buffer);
};

const encodeU128 = (value: bigint) => {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setBigUint64(0, value & 0xFFFFFFFFFFFFFFFFn, true);
  view.setBigUint64(8, value >> 64n, true);
  return new Uint8Array(buffer);
};

const serializeEncryptedSet = (set: EncryptedSet): Uint8Array => {
  // items: [[u8;32];4] = 128 bytes, count: [u8;32] = 32 bytes
  // pubkey: [u8;32] = 32 bytes, nonce: u128 = 16 bytes
  // Anchor order matches the instruction parameter order:
  // set_x_items, set_x_count, set_x_pubkey, set_x_nonce
  return concatBytes(
    ...set.encryptedItems,
    set.encryptedCount,
    set.pubkey,
    encodeU128(set.nonce),
  );
};

const serializeAccounts = (instruction: TransactionInstruction): SerializedInstructionAccount[] =>
  instruction.keys.map((key) => ({
    pubkey: key.pubkey.toBase58(),
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));

const buildInstructionDiscriminator = async (instructionName: SessionInstructionPlan["instructionName"]) => {
  const payload = new TextEncoder().encode(`global:${instructionName}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  return new Uint8Array(digest).slice(0, 8);
};

const buildAnchorInstructionData = async (instructionName: SessionInstructionPlan["instructionName"], ...args: Uint8Array[]) =>
  concatBytes(await buildInstructionDiscriminator(instructionName), ...args);

export const buildCreateSessionInstructionData = async (sessionDraft: Pick<SessionDraft, "sessionId" | "commitmentHex" | "assetMask" | "expiresAt">) =>
  buildAnchorInstructionData(
    "create_session",
    decodeSessionId(sessionDraft.sessionId),
    hexToBytes(sessionDraft.commitmentHex),
    new Uint8Array([sessionDraft.assetMask]),
    encodeI64(Math.floor(Date.parse(sessionDraft.expiresAt) / 1000)),
  );

export const buildCommitSetInstructionData = async (commitmentHex: string) => buildAnchorInstructionData("commit_set", hexToBytes(commitmentHex));

/**
 * Build the full serialised instruction data for `start_psi`.
 *
 * Layout (432 bytes total after the 8-byte discriminator):
 *   computation_offset  u64       8 bytes
 *   set_a_items         [[u8;32];4] 128 bytes
 *   set_a_count         [u8;32]   32 bytes
 *   set_a_pubkey        [u8;32]   32 bytes
 *   set_a_nonce         u128      16 bytes
 *   set_b_items         [[u8;32];4] 128 bytes
 *   set_b_count         [u8;32]   32 bytes
 *   set_b_pubkey        [u8;32]   32 bytes
 *   set_b_nonce         u128      16 bytes
 */
export const buildStartPsiInstructionData = async (params: StartPsiParams): Promise<Uint8Array> => {
  const ownSet = await encryptSetForMXE(params.ownFingerprintHexes, params.clusterX25519Pubkey);
  const otherSet = emptyEncryptedSet();

  const [setA, setB] = params.isInitiator
    ? [ownSet, otherSet]
    : [otherSet, ownSet];

  return buildAnchorInstructionData(
    "start_psi",
    encodeU64(params.computationOffset),
    serializeEncryptedSet(setA),
    serializeEncryptedSet(setB),
  );
};

export const getSilentCircleProgramId = (programId = import.meta.env.VITE_SILENT_CIRCLE_PROGRAM_ID) =>
  new PublicKey(programId?.trim() || PLACEHOLDER_PROGRAM_ID);

export const hasConfiguredSilentCircleProgram = (programId = import.meta.env.VITE_SILENT_CIRCLE_PROGRAM_ID) => {
  const value = programId?.trim();
  return Boolean(value && value !== PLACEHOLDER_PROGRAM_ID);
};

export const deriveSessionPda = (sessionId: string, programId = getSilentCircleProgramId()) =>
  PublicKey.findProgramAddress([new TextEncoder().encode(SESSION_SEED), decodeSessionId(sessionId)], programId);

export const createSessionInstruction = async (sessionDraft: SessionDraft, signer = sessionDraft.walletAddress, programId = getSilentCircleProgramId()) => {
  const [sessionPda] = await deriveSessionPda(sessionDraft.sessionId, programId);
  const instructionData = await buildCreateSessionInstructionData(sessionDraft);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(signer), isSigner: true, isWritable: true },
      { pubkey: sessionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });
};

export const createCommitSetInstruction = async ({ sessionId, signer, commitmentHex }: BuildCommitSetPlanInput, programId = getSilentCircleProgramId()) => {
  const [sessionPda] = await deriveSessionPda(sessionId, programId);
  const instructionData = await buildCommitSetInstructionData(commitmentHex);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: new PublicKey(signer), isSigner: true, isWritable: true },
      { pubkey: sessionPda, isSigner: false, isWritable: true },
    ],
    data: instructionData,
  });
};

export const createStartPsiInstruction = async (params: StartPsiParams, programId = getSilentCircleProgramId()) => {
  const [sessionPda] = await deriveSessionPda(params.sessionId, programId);
  const instructionData = await buildStartPsiInstructionData(params);
  const signerPubkey = new PublicKey(params.signer);
  const signPda = deriveSignPda(programId);
  const computationAccount = deriveComputationAccount(params.computationOffset);

  // Account order must match the StartPsi context struct in start_psi.rs.
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: signerPubkey,             isSigner: true,  isWritable: true  }, // signer
      { pubkey: sessionPda,               isSigner: false, isWritable: true  }, // session
      { pubkey: signPda,                  isSigner: false, isWritable: true  }, // sign_pda_account
      { pubkey: arciumMxeAccount,         isSigner: false, isWritable: false }, // mxe_account
      { pubkey: arciumMempoolAccount,     isSigner: false, isWritable: true  }, // mempool_account
      { pubkey: arciumExecpoolAccount,    isSigner: false, isWritable: true  }, // executing_pool
      { pubkey: computationAccount,       isSigner: false, isWritable: true  }, // computation_account
      { pubkey: arciumCompDefAccount,     isSigner: false, isWritable: false }, // comp_def_account
      { pubkey: arciumClusterAccount,     isSigner: false, isWritable: true  }, // cluster_account
      { pubkey: arciumFeePoolAccount,     isSigner: false, isWritable: true  }, // pool_account
      { pubkey: arciumClockAccount,       isSigner: false, isWritable: true  }, // clock_account
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false }, // system_program
      { pubkey: arciumProgramId,          isSigner: false, isWritable: false }, // arcium_program
    ],
    data: instructionData,
  });
};

export const buildCreateSessionPlan = async (sessionDraft: SessionDraft, signer = sessionDraft.walletAddress, programId = getSilentCircleProgramId()): Promise<SessionInstructionPlan> => {
  const instruction = await createSessionInstruction(sessionDraft, signer, programId);

  return {
    instructionName: "create_session",
    programId: instruction.programId.toBase58(),
    sessionId: sessionDraft.sessionId,
    sessionPda: instruction.keys[1].pubkey.toBase58(),
    signer,
    instructionDataHex: bytesToHex(instruction.data),
    accounts: serializeAccounts(instruction),
  };
};

export const buildCommitSetPlan = async ({ sessionId, signer, commitmentHex }: BuildCommitSetPlanInput, programId = getSilentCircleProgramId()): Promise<SessionInstructionPlan> => {
  const instruction = await createCommitSetInstruction({ sessionId, signer, commitmentHex }, programId);

  return {
    instructionName: "commit_set",
    programId: instruction.programId.toBase58(),
    sessionId,
    sessionPda: instruction.keys[1].pubkey.toBase58(),
    signer,
    instructionDataHex: bytesToHex(instruction.data),
    accounts: serializeAccounts(instruction),
  };
};

export const buildStartPsiPlan = async (params: StartPsiParams, programId = getSilentCircleProgramId()): Promise<SessionInstructionPlan> => {
  const instruction = await createStartPsiInstruction(params, programId);

  return {
    instructionName: "start_psi",
    programId: instruction.programId.toBase58(),
    sessionId: params.sessionId,
    sessionPda: instruction.keys[1].pubkey.toBase58(),
    signer: params.signer,
    instructionDataHex: bytesToHex(instruction.data),
    accounts: serializeAccounts(instruction),
  };
};

export const serializeSessionInstructionPlan = (plan: SessionInstructionPlan) => JSON.stringify(plan, null, 2);
