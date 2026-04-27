import { describe, expect, it } from "vitest";

import {
  assetCatalog,
  assetMaskFromSelection,
  extractDaoMemberships,
  extractNftCollectionMints,
  extractTokenMints,
  fetchAssetSnapshot,
  fetchAssetCounts,
  fetchDaoMemberships,
  fetchNftCollectionMints,
  placeholderAssetCounts,
  placeholderAssetSnapshot,
  selectionFromAssetMask,
  sumSelectedAssetCounts,
} from "@/lib/assets";

describe("asset utilities", () => {
  it("encodes selected asset groups into the expected bitmask", () => {
    expect(assetMaskFromSelection(["tokens"])).toBe(0b001);
    expect(assetMaskFromSelection(["tokens", "daos"])).toBe(0b101);
    expect(assetMaskFromSelection(["tokens", "nfts", "daos"])).toBe(0b111);
  });

  it("decodes a bitmask back into asset selections", () => {
    expect(selectionFromAssetMask(0b110)).toEqual(["nfts", "daos"]);
    expect(selectionFromAssetMask(0b000)).toEqual([]);
  });

  it("keeps the catalog aligned with the supported asset groups", () => {
    expect(assetCatalog.map((asset) => asset.value)).toEqual(["tokens", "nfts", "daos"]);
  });

  it("starts placeholder asset counts at zero", () => {
    expect(sumSelectedAssetCounts(["tokens", "daos"], placeholderAssetCounts)).toBe(0);
    expect(placeholderAssetSnapshot.counts).toEqual({
      tokens: 0,
      nfts: 0,
      daos: 0,
    });
  });

  it("extracts unique SPL token mints from parsed token accounts", () => {
    expect(
      extractTokenMints([
        { account: { data: { parsed: { type: "account", info: { mint: "MintA" } } } } },
        { account: { data: { parsed: { type: "account", info: { mint: "MintA" } } } } },
        { account: { data: { parsed: { type: "account", info: { mint: "MintB" } } } } },
        { account: { data: { parsed: { type: "mint", info: { mint: "Ignored" } } } } },
      ]),
    ).toEqual(["MintA", "MintB"]);
  });

  it("extracts verified NFT collection addresses and ignores unverified collections", () => {
    expect(
      extractNftCollectionMints([
        { collection: { address: "CollectionA", verified: true } },
        { collection: { address: "CollectionA", verified: true } },
        { collection: { address: "CollectionB", verified: false } },
        { collection: null },
      ]),
    ).toEqual(["CollectionA"]);
  });

  it("extracts unique DAO realm memberships", () => {
    expect(
      extractDaoMemberships([
        { account: { realm: "RealmA" } },
        { account: { realm: "RealmA" } },
        { account: { realm: "RealmB" } },
      ]),
    ).toEqual(["RealmA", "RealmB"]);
  });

  it("fetches NFT collections using the injected owner query", async () => {
    const connection = {};
    const findNftsByOwner = async () => [
      { collection: { address: "CollectionA", verified: true } },
      { collection: { address: "CollectionB", verified: true } },
      { collection: { address: "CollectionB", verified: true } },
    ];

    await expect(fetchNftCollectionMints(connection as never, "11111111111111111111111111111111", findNftsByOwner)).resolves.toEqual([
      "CollectionA",
      "CollectionB",
    ]);
  });

  it("fetches DAO memberships using the injected governance query", async () => {
    const connection = {};
    const findDaoMembershipsByOwner = async () => [
      { account: { realm: "RealmA" } },
      { account: { realm: "RealmB" } },
      { account: { realm: "RealmA" } },
    ];

    await expect(fetchDaoMemberships(connection as never, "11111111111111111111111111111111", findDaoMembershipsByOwner)).resolves.toEqual([
      "RealmA",
      "RealmB",
    ]);
  });

  it("fetches asset counts using live token-account shape", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          { account: { data: { parsed: { type: "account", info: { mint: "MintA" } } } } },
          { account: { data: { parsed: { type: "account", info: { mint: "MintB" } } } } },
          { account: { data: { parsed: { type: "account", info: { mint: "MintB" } } } } },
        ],
      }),
    };

    await expect(fetchAssetCounts("11111111111111111111111111111111", connection)).resolves.toEqual({
      tokens: 2,
      nfts: 0,
      daos: 0,
    });
  });

  it("returns a live asset snapshot with token mints", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          { account: { data: { parsed: { type: "account", info: { mint: "MintA" } } } } },
          { account: { data: { parsed: { type: "account", info: { mint: "MintB" } } } } },
        ],
      }),
    };

    const findNftsByOwner = async () => [
      { collection: { address: "CollectionA", verified: true } },
      { collection: { address: "CollectionA", verified: true } },
      { collection: { address: "CollectionB", verified: true } },
    ];

    const findDaoMembershipsByOwner = async () => [
      { account: { realm: "RealmA" } },
      { account: { realm: "RealmB" } },
    ];

    await expect(fetchAssetSnapshot("11111111111111111111111111111111", connection as never, findNftsByOwner, findDaoMembershipsByOwner)).resolves.toEqual({
      counts: {
        tokens: 2,
        nfts: 2,
        daos: 2,
      },
      tokenMints: ["MintA", "MintB"],
      nftCollections: ["CollectionA", "CollectionB"],
      daoMemberships: ["RealmA", "RealmB"],
      labelsByAssetId: {},
    });
  });

  it("keeps successful asset groups when one live fetcher fails", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [{ account: { data: { parsed: { type: "account", info: { mint: "MintA" } } } } }],
      }),
    };

    const findNftsByOwner = async () => {
      throw new Error("NFT RPC failed");
    };

    const findDaoMembershipsByOwner = async () => [{ account: { realm: "RealmA" } }];

    await expect(fetchAssetSnapshot("11111111111111111111111111111111", connection as never, findNftsByOwner, findDaoMembershipsByOwner)).resolves.toEqual({
      counts: {
        tokens: 1,
        nfts: 0,
        daos: 1,
      },
      tokenMints: ["MintA"],
      nftCollections: [],
      daoMemberships: ["RealmA"],
      labelsByAssetId: {},
    });
  });

  it("attaches human-readable asset labels when metadata resolvers are available", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [{ account: { data: { parsed: { type: "account", info: { mint: "MintA" } } } } }],
      }),
    };

    const findNftsByOwner = async () => [{ collection: { address: "CollectionA", verified: true } }];
    const findDaoMembershipsByOwner = async () => [{ account: { realm: "RealmA" } }];

    await expect(
      fetchAssetSnapshot("11111111111111111111111111111111", connection as never, findNftsByOwner, findDaoMembershipsByOwner, {
        resolveTokenMintLabels: async () => ({ MintA: "Wrapped SOL" }),
        resolveNftCollectionLabels: async () => ({ CollectionA: "Mad Lads" }),
        resolveDaoMembershipLabels: async () => ({ RealmA: "Realms Governance" }),
      }),
    ).resolves.toEqual({
      counts: {
        tokens: 1,
        nfts: 1,
        daos: 1,
      },
      tokenMints: ["MintA"],
      nftCollections: ["CollectionA"],
      daoMemberships: ["RealmA"],
      labelsByAssetId: {
        MintA: "Wrapped SOL",
        CollectionA: "Mad Lads",
        RealmA: "Realms Governance",
      },
    });
  });
});
