import { describe, expect, it } from "vitest";

import type { CommitmentPreview } from "@/lib/commitment";
import { createSessionDraft, parseSessionDraft, serializeSessionDraft } from "@/lib/session-draft";
import { encodeSessionId } from "@/lib/session";

const commitmentPreview: CommitmentPreview = {
  assetIds: ["asset-a", "asset-b"],
  assetHashesHex: ["aa", "bb"],
  commitmentHex: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

describe("session draft utilities", () => {
  it("builds a session draft with session bytes, commitment, and expiry", () => {
    const sessionId = encodeSessionId(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const draft = createSessionDraft({
      sessionId,
      walletAddress: "11111111111111111111111111111111",
      assetMask: 0b101,
      commitmentPreview,
      pendingAssetGroups: ["daos"],
      createdAtMs: Date.UTC(2026, 3, 27, 0, 0, 0),
    });

    expect(draft).toEqual({
      sessionId,
      sessionIdHex: "0102030405060708",
      walletAddress: "11111111111111111111111111111111",
      assetMask: 0b101,
      assetMaskBinary: "101",
      commitmentHex: commitmentPreview.commitmentHex,
      hashableAssetCount: 2,
      pendingAssetGroups: ["daos"],
      createdAt: "2026-04-27T00:00:00.000Z",
      expiresAt: "2026-04-28T00:00:00.000Z",
    });
  });

  it("serializes a session draft as formatted JSON", () => {
    const sessionId = encodeSessionId(new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]));
    const serialized = serializeSessionDraft(
      createSessionDraft({
        sessionId,
        walletAddress: "11111111111111111111111111111111",
        assetMask: 0b001,
        commitmentPreview,
        pendingAssetGroups: [],
        createdAtMs: Date.UTC(2026, 3, 27, 12, 0, 0),
      }),
    );

    expect(JSON.parse(serialized)).toMatchObject({
      sessionId,
      assetMaskBinary: "001",
      hashableAssetCount: 2,
    });
  });

  it("rejects session drafts without a wallet address", () => {
    const sessionId = encodeSessionId(new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]));

    expect(() =>
      createSessionDraft({
        sessionId,
        walletAddress: "",
        assetMask: 0b001,
        commitmentPreview,
        pendingAssetGroups: [],
      }),
    ).toThrow("A wallet address is required to create a session draft.");
  });

  it("parses persisted session drafts and rejects invalid input", () => {
    const sessionId = encodeSessionId(new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2]));
    const draft = createSessionDraft({
      sessionId,
      walletAddress: "11111111111111111111111111111111",
      assetMask: 0b001,
      commitmentPreview,
      pendingAssetGroups: [],
      createdAtMs: Date.UTC(2026, 3, 27, 12, 0, 0),
    });

    expect(parseSessionDraft(JSON.parse(serializeSessionDraft(draft)))).toEqual(draft);
    expect(parseSessionDraft({ sessionId: 123 })).toBeNull();
  });
});