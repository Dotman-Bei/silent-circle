import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { buildCommitmentPreview, buildSnapshotCommitmentPreview, getHashableAssetIds, getPendingCommitmentGroups, shortenCommitmentHex } from "@/lib/commitment";
import type { AssetSnapshot } from "@/lib/assets";

const createAssetId = (seed: number) => new PublicKey(new Uint8Array(32).fill(seed)).toBase58();

const baseSnapshot: AssetSnapshot = {
  counts: {
    tokens: 2,
    nfts: 2,
    daos: 2,
  },
  tokenMints: [createAssetId(2), createAssetId(1)],
  nftCollections: [createAssetId(4), createAssetId(3)],
  daoMemberships: [createAssetId(6), createAssetId(5)],
  labelsByAssetId: {},
};

describe("commitment utilities", () => {
  it("builds the same commitment for the same set regardless of order or duplicates", async () => {
    const assetIdA = createAssetId(1);
    const assetIdB = createAssetId(2);

    const firstPreview = await buildCommitmentPreview([assetIdA, assetIdB, assetIdA]);
    const secondPreview = await buildCommitmentPreview([assetIdB, assetIdA]);

    expect(firstPreview).not.toBeNull();
    expect(secondPreview).not.toBeNull();
    expect(firstPreview?.assetIds).toEqual([assetIdA, assetIdB]);
    expect(secondPreview?.assetIds).toEqual([assetIdA, assetIdB]);
    expect(firstPreview?.commitmentHex).toBe(secondPreview?.commitmentHex);
  });

  it("returns only the currently hashable asset IDs from a snapshot", () => {
    expect(getHashableAssetIds(["tokens", "nfts", "daos"], baseSnapshot)).toEqual([
      createAssetId(1),
      createAssetId(2),
      createAssetId(3),
      createAssetId(4),
      createAssetId(5),
      createAssetId(6),
    ]);
    expect(getPendingCommitmentGroups(["tokens", "nfts", "daos"])).toEqual([]);
  });

  it("builds a deterministic empty-set commitment when no live hashable assets are available", async () => {
    const firstPreview = await buildSnapshotCommitmentPreview(["nfts"], {
      ...baseSnapshot,
      nftCollections: [],
      counts: { ...baseSnapshot.counts, nfts: 0 },
    });
    const secondPreview = await buildCommitmentPreview([]);

    expect(firstPreview).toEqual(secondPreview);
    expect(firstPreview).toEqual({
      assetIds: [],
      assetHashesHex: [],
      commitmentHex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  });

  it("shortens commitment hex for compact display", () => {
    expect(shortenCommitmentHex("1234567890abcdef1234567890abcdef", 6)).toBe("123456…abcdef");
  });
});
