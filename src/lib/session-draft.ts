import type { AssetValue } from "@/lib/assets";
import type { CommitmentPreview } from "@/lib/commitment";
import { decodeSessionId } from "@/lib/session";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type SessionDraft = {
  sessionId: string;
  sessionIdHex: string;
  walletAddress: string;
  assetMask: number;
  assetMaskBinary: string;
  commitmentHex: string;
  hashableAssetCount: number;
  pendingAssetGroups: AssetValue[];
  createdAt: string;
  expiresAt: string;
};

type CreateSessionDraftInput = {
  sessionId: string;
  walletAddress: string;
  assetMask: number;
  commitmentPreview: CommitmentPreview;
  pendingAssetGroups: AssetValue[];
  createdAtMs?: number;
  ttlMs?: number;
};

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const createSessionDraft = ({
  sessionId,
  walletAddress,
  assetMask,
  commitmentPreview,
  pendingAssetGroups,
  createdAtMs = Date.now(),
  ttlMs = SESSION_TTL_MS,
}: CreateSessionDraftInput): SessionDraft => {
  if (!walletAddress) {
    throw new Error("A wallet address is required to create a session draft.");
  }

  if (!commitmentPreview.commitmentHex) {
    throw new Error("A live commitment is required to create a session draft.");
  }

  const createdAt = new Date(createdAtMs);
  const expiresAt = new Date(createdAtMs + ttlMs);

  return {
    sessionId,
    sessionIdHex: bytesToHex(decodeSessionId(sessionId)),
    walletAddress,
    assetMask,
    assetMaskBinary: assetMask.toString(2).padStart(3, "0"),
    commitmentHex: commitmentPreview.commitmentHex,
    hashableAssetCount: commitmentPreview.assetIds.length,
    pendingAssetGroups,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
};

export const serializeSessionDraft = (sessionDraft: SessionDraft) => JSON.stringify(sessionDraft, null, 2);

export const parseSessionDraft = (value: unknown): SessionDraft | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const draft = value as Partial<SessionDraft>;

  if (
    typeof draft.sessionId !== "string" ||
    typeof draft.sessionIdHex !== "string" ||
    typeof draft.walletAddress !== "string" ||
    typeof draft.assetMask !== "number" ||
    typeof draft.assetMaskBinary !== "string" ||
    typeof draft.commitmentHex !== "string" ||
    typeof draft.hashableAssetCount !== "number" ||
    !Array.isArray(draft.pendingAssetGroups) ||
    typeof draft.createdAt !== "string" ||
    typeof draft.expiresAt !== "string"
  ) {
    return null;
  }

  return {
    sessionId: draft.sessionId,
    sessionIdHex: draft.sessionIdHex,
    walletAddress: draft.walletAddress,
    assetMask: draft.assetMask,
    assetMaskBinary: draft.assetMaskBinary,
    commitmentHex: draft.commitmentHex,
    hashableAssetCount: draft.hashableAssetCount,
    pendingAssetGroups: draft.pendingAssetGroups,
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt,
  };
};