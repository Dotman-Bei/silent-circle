import { PublicKey, type Connection } from "@solana/web3.js";

import { deriveSessionPda, getSilentCircleProgramId } from "@/lib/session-client";
import { solanaConnection } from "@/lib/solana";

const SESSION_DISCRIMINATOR = new Uint8Array([213, 62, 101, 203, 86, 104, 98, 172]);
const EMPTY_PUBLIC_KEY = "11111111111111111111111111111111";

type SessionConnectionLike = Pick<Connection, "getAccountInfo">;

export type SessionAccountState = "AwaitingCounterparty" | "BothCommitted" | "Computing" | "Done" | "Expired";

export type SessionAccount = {
  address: string;
  walletA: string;
  walletB: string | null;
  commitmentAHex: string;
  commitmentBHex: string;
  arciumTaskId: number;
  state: SessionAccountState;
  intersectionCount: number;
  intersectionHashesHex: string[];
  assetMask: number;
  createdAtUnix: number;
  expiresAtUnix: number;
  bump: number;
};

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const readPublicKey = (data: Uint8Array, offset: number) => new PublicKey(data.slice(offset, offset + 32));

const readU64 = (data: Uint8Array, offset: number) => Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true));

const readI64 = (data: Uint8Array, offset: number) => Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true));

const readU32 = (data: Uint8Array, offset: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);

const decodeSessionState = (value: number): SessionAccountState => {
  switch (value) {
    case 0:
      return "AwaitingCounterparty";
    case 1:
      return "BothCommitted";
    case 2:
      return "Computing";
    case 3:
      return "Done";
    case 4:
      return "Expired";
    default:
      throw new Error(`Unsupported SessionState variant: ${value}`);
  }
};

const assertSessionDiscriminator = (data: Uint8Array) => {
  if (data.length < SESSION_DISCRIMINATOR.length) {
    throw new Error("Session account data is too short.");
  }

  for (let index = 0; index < SESSION_DISCRIMINATOR.length; index += 1) {
    if (data[index] !== SESSION_DISCRIMINATOR[index]) {
      throw new Error("Account discriminator does not match Session.");
    }
  }
};

export const mapSessionStateToPhase = (state: SessionAccountState) => {
  switch (state) {
    case "AwaitingCounterparty":
      return 0;
    case "BothCommitted":
      return 1;
    case "Computing":
      return 2;
    case "Done":
    case "Expired":
      return 3;
  }
};

export const decodeSessionAccount = (address: string, data: Uint8Array): SessionAccount => {
  assertSessionDiscriminator(data);

  let offset = SESSION_DISCRIMINATOR.length;

  const walletA = readPublicKey(data, offset);
  offset += 32;

  const walletB = readPublicKey(data, offset);
  offset += 32;

  const commitmentA = data.slice(offset, offset + 32);
  offset += 32;

  const commitmentB = data.slice(offset, offset + 32);
  offset += 32;

  const arciumTaskId = readU64(data, offset);
  offset += 8;

  const state = decodeSessionState(data[offset]);
  offset += 1;

  // Correct Borsh layout matching the Rust Session struct field order:
  // state → asset_mask → created_at → expires_at → bump → state_nonce → intersection

  const assetMask = data[offset];
  offset += 1;

  const createdAtUnix = readI64(data, offset);
  offset += 8;

  const expiresAtUnix = readI64(data, offset);
  offset += 8;

  const bump = data[offset];
  offset += 1;

  // Skip state_nonce: u128 (16 bytes) — not exposed in the client type
  offset += 16;

  const intersectionCount = readU32(data, offset);
  offset += 4;

  const intersectionHashesHex = Array.from({ length: intersectionCount }, () => {
    const intersectionHash = data.slice(offset, offset + 32);
    offset += 32;
    return bytesToHex(intersectionHash);
  });

  const walletBBase58 = walletB.toBase58();

  return {
    address,
    walletA: walletA.toBase58(),
    walletB: walletBBase58 === EMPTY_PUBLIC_KEY ? null : walletBBase58,
    commitmentAHex: bytesToHex(commitmentA),
    commitmentBHex: bytesToHex(commitmentB),
    arciumTaskId,
    state,
    intersectionCount,
    intersectionHashesHex,
    assetMask,
    createdAtUnix,
    expiresAtUnix,
    bump,
  };
};

export const fetchSessionAccount = async (
  sessionId: string,
  connection: SessionConnectionLike = solanaConnection,
  programId = getSilentCircleProgramId(),
) => {
  const [sessionPda] = await deriveSessionPda(sessionId, programId);
  const accountInfo = await connection.getAccountInfo(sessionPda, "confirmed");

  if (!accountInfo) {
    return null;
  }

  if (!accountInfo.owner.equals(programId)) {
    throw new Error("Session PDA is owned by an unexpected program.");
  }

  return decodeSessionAccount(sessionPda.toBase58(), accountInfo.data);
};
