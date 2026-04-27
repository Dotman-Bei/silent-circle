import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCommitSetInstructionData,
  buildCommitSetPlan,
  buildCreateSessionInstructionData,
  buildCreateSessionPlan,
  buildStartPsiInstructionData,
  buildStartPsiPlan,
  hasConfiguredSilentCircleProgram,
  type StartPsiParams,
} from "@/lib/session-client";
import type { SessionDraft } from "@/lib/session-draft";

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const mockSessionPda = new PublicKey("So11111111111111111111111111111111111111112");

// Stable mock params for start_psi — 32 zero bytes is a valid (though insecure)
// X25519 public key for testing; encryption is mocked away via vi.mock.
const startPsiParams: StartPsiParams = {
  sessionId: "An6UebxCZd",
  signer: "11111111111111111111111111111111",
  ownFingerprintHexes: [
    "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
    "1122334455667788990011223344556677889900112233445566778899001122",
  ],
  isInitiator: true,
  clusterX25519Pubkey: new Uint8Array(32),
  computationOffset: 0n,
};

// Mock arcium-encrypt so tests are deterministic and don't need real crypto keys.
vi.mock("@/lib/arcium-encrypt", () => ({
  encryptSetForMXE: async () => ({
    pubkey: new Uint8Array(32),
    nonce: 0n,
    encryptedItems: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)],
    encryptedCount: new Uint8Array(32),
  }),
  emptyEncryptedSet: () => ({
    pubkey: new Uint8Array(32),
    nonce: 0n,
    encryptedItems: [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)],
    encryptedCount: new Uint8Array(32),
  }),
}));

const sessionDraft: SessionDraft = {
  sessionId: "An6UebxCZd",
  sessionIdHex: "0102030405060708",
  walletAddress: "11111111111111111111111111111111",
  assetMask: 0b111,
  assetMaskBinary: "111",
  commitmentHex: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  hashableAssetCount: 6,
  pendingAssetGroups: [],
  createdAt: "2026-04-27T00:00:00.000Z",
  expiresAt: "2026-04-28T00:00:00.000Z",
};

describe("session client utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds create_session instruction data with encoded arguments", async () => {
    const instructionData = await buildCreateSessionInstructionData(sessionDraft);
    const instructionDataHex = bytesToHex(instructionData);

    expect(instructionDataHex).toHaveLength(114);
    expect(instructionDataHex.slice(16, 32)).toBe(sessionDraft.sessionIdHex);
    expect(instructionDataHex.slice(32, 96)).toBe(sessionDraft.commitmentHex);
    expect(instructionDataHex.slice(96, 98)).toBe("07");
  });

  it("builds a create_session plan with encoded arguments and account metadata", async () => {
    vi.spyOn(PublicKey, "findProgramAddress").mockResolvedValue([mockSessionPda, 255]);

    const plan = await buildCreateSessionPlan(sessionDraft);

    expect(plan.instructionName).toBe("create_session");
    expect(plan.sessionId).toBe(sessionDraft.sessionId);
    expect(plan.signer).toBe(sessionDraft.walletAddress);
    expect(plan.sessionPda).toBe(mockSessionPda.toBase58());
    expect(plan.accounts).toHaveLength(3);
    expect(plan.instructionDataHex).toHaveLength(114);
    expect(plan.instructionDataHex.slice(16, 32)).toBe(sessionDraft.sessionIdHex);
    expect(plan.instructionDataHex.slice(32, 96)).toBe(sessionDraft.commitmentHex);
    expect(plan.instructionDataHex.slice(96, 98)).toBe("07");
  });

  it("builds commit_set and start_psi instruction data and plans", async () => {
    const commitInstructionData = await buildCommitSetInstructionData(sessionDraft.commitmentHex);
    const startInstructionData = await buildStartPsiInstructionData(startPsiParams);

    // commit_set: 8-byte discriminator + 32-byte commitment = 40 bytes = 80 hex chars
    expect(bytesToHex(commitInstructionData)).toHaveLength(80);

    // start_psi: 8-byte discriminator + 8-byte computation_offset
    //          + 2 × (128 + 32 + 32 + 16) bytes encrypted sets = 8 + 8 + 416 = 432 bytes = 864 hex chars
    expect(bytesToHex(startInstructionData)).toHaveLength(864);

    vi.spyOn(PublicKey, "findProgramAddress").mockResolvedValue([mockSessionPda, 255]);
    vi.spyOn(PublicKey, "findProgramAddressSync").mockReturnValue([mockSessionPda, 255]);

    const commitPlan = await buildCommitSetPlan({
      sessionId: sessionDraft.sessionId,
      signer: sessionDraft.walletAddress,
      commitmentHex: sessionDraft.commitmentHex,
    });
    const startPlan = await buildStartPsiPlan(startPsiParams);

    expect(commitPlan.instructionName).toBe("commit_set");
    expect(commitPlan.instructionDataHex).toHaveLength(80);
    expect(commitPlan.sessionPda).toBe(mockSessionPda.toBase58());
    expect(startPlan.instructionName).toBe("start_psi");
    expect(startPlan.instructionDataHex).toHaveLength(864);
    expect(startPlan.accounts).toHaveLength(13);
    expect(commitPlan.sessionPda).toBe(startPlan.sessionPda);
  });

  it("detects whether a real program id is configured", () => {
    expect(hasConfiguredSilentCircleProgram("")).toBe(false);
    expect(hasConfiguredSilentCircleProgram("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).toBe(false);
    expect(hasConfiguredSilentCircleProgram("So11111111111111111111111111111111111111112")).toBe(true);
  });
});
