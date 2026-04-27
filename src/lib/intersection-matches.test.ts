import { describe, expect, it } from "vitest";

import { buildSnapshotCommitmentPreview } from "@/lib/commitment";
import { resolveSessionIntersectionMatches } from "@/lib/intersection-matches";
import type { SessionAccount } from "@/lib/session-account";

const snapshot = {
  counts: {
    tokens: 1,
    nfts: 1,
    daos: 1,
  },
  tokenMints: ["So11111111111111111111111111111111111111112"],
  nftCollections: ["Vote111111111111111111111111111111111111111"],
  daoMemberships: ["Stake11111111111111111111111111111111111111"],
  labelsByAssetId: {
    So11111111111111111111111111111111111111112: "Wrapped SOL",
    Vote111111111111111111111111111111111111111: "Mad Lads",
    Stake11111111111111111111111111111111111111: "Realms Governance",
  },
};

const baseSessionAccount: SessionAccount = {
  address: "Session1111111111111111111111111111111111",
  walletA: "So11111111111111111111111111111111111111112",
  walletB: "Vote111111111111111111111111111111111111111",
  commitmentAHex: "",
  commitmentBHex: "",
  arciumTaskId: 1,
  state: "Done",
  intersectionCount: 0,
  intersectionHashesHex: [],
  assetMask: 0b111,
  createdAtUnix: 0,
  expiresAtUnix: 0,
  bump: 255,
};

describe("intersection match resolution", () => {
  it("maps on-chain intersection hashes back into typed local assets", async () => {
    const preview = await buildSnapshotCommitmentPreview(["tokens", "nfts", "daos"], snapshot);

    if (!preview) {
      throw new Error("Preview was expected for the test snapshot.");
    }

    // On-chain intersection stores u64_le fingerprints padded to [u8; 32].
    // The fingerprint = first 8 bytes of the asset's SHA-256. We simulate that
    // by taking the first 16 hex chars of the full hash and padding with 48 zeros.
    const onChainHash = (fullHashHex: string) => fullHashHex.slice(0, 16).padEnd(64, "0");

    const matches = await resolveSessionIntersectionMatches(
      {
        ...baseSessionAccount,
        intersectionCount: 2,
        intersectionHashesHex: [
          onChainHash(preview.assetHashesHex[preview.assetIds.indexOf("So11111111111111111111111111111111111111112")]),
          onChainHash(preview.assetHashesHex[preview.assetIds.indexOf("Stake11111111111111111111111111111111111111")]),
        ],
      },
      snapshot,
    );

    expect(matches).toEqual([
      expect.objectContaining({ type: "Token", assetId: "So11111111111111111111111111111111111111112", label: "Wrapped SOL", labelSource: "metadata" }),
      expect.objectContaining({ type: "DAO", assetId: "Stake11111111111111111111111111111111111111", label: "Realms Governance", labelSource: "metadata" }),
    ]);
  });

  it("marks shortened address labels as fallback when no metadata name is available", async () => {
    const preview = await buildSnapshotCommitmentPreview(["tokens"], {
      ...snapshot,
      nftCollections: [],
      daoMemberships: [],
      labelsByAssetId: {},
    });

    if (!preview) {
      throw new Error("Preview was expected for the fallback label test.");
    }

    const matches = await resolveSessionIntersectionMatches(
      {
        ...baseSessionAccount,
        assetMask: 0b001,
        intersectionCount: 1,
        // Simulate on-chain format: first 8 bytes (16 hex) are the u64 fingerprint, rest zeros
        intersectionHashesHex: [preview.assetHashesHex[0].slice(0, 16).padEnd(64, "0")],
      },
      {
        ...snapshot,
        nftCollections: [],
        daoMemberships: [],
        labelsByAssetId: {},
      },
    );

    expect(matches).toEqual([
      expect.objectContaining({
        type: "Token",
        assetId: "So11111111111111111111111111111111111111112",
        label: "Mint So1111…111112",
        labelSource: "fallback",
      }),
    ]);
  });

  it("falls back to unresolved hash cards when the local snapshot cannot map them", async () => {
    const matches = await resolveSessionIntersectionMatches(
      {
        ...baseSessionAccount,
        intersectionCount: 1,
        intersectionHashesHex: ["1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
      },
      snapshot,
    );

    expect(matches).toEqual([
      expect.objectContaining({
        type: "Unknown",
        assetId: null,
        hashHex: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        labelSource: "hash",
      }),
    ]);
  });
});