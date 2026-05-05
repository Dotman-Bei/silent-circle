import { PublicKey, type Connection } from "@solana/web3.js";

import { solanaConnection } from "@/lib/solana";
import { LOCAL_TOKEN_REGISTRY } from "@/lib/token-registry";

export const assetCatalog = [
  { label: "SPL Tokens", value: "tokens" },
  { label: "NFT Collections", value: "nfts" },
  { label: "DAO Memberships", value: "daos" },
] as const;

export type AssetValue = (typeof assetCatalog)[number]["value"];
export type AssetCounts = Record<AssetValue, number>;
export type AssetLabels = Record<string, string>;
export type AssetSnapshot = {
  counts: AssetCounts;
  tokenMints: string[];
  nftCollections: string[];
  daoMemberships: string[];
  labelsByAssetId: AssetLabels;
};

type PublicKeyLike = string | PublicKey | { toBase58: () => string };

type NftCollectionAsset = {
  collection?: {
    address: PublicKeyLike;
    verified?: boolean;
  } | null;
};

type TokenOwnerRecordLike = {
  account: {
    realm: PublicKeyLike;
  };
};

type FindNftsByOwner = (connection: Connection, owner: PublicKey) => Promise<NftCollectionAsset[]>;
type FindDaoMembershipsByOwner = (connection: Connection, owner: PublicKey) => Promise<TokenOwnerRecordLike[]>;
type ResolveAssetLabels = (connection: Connection, assetIds: string[]) => Promise<AssetLabels>;
type AssetLabelResolvers = {
  resolveTokenMintLabels?: ResolveAssetLabels;
  resolveNftCollectionLabels?: ResolveAssetLabels;
  resolveDaoMembershipLabels?: ResolveAssetLabels;
};

type ParsedTokenAccount = {
  account: {
    data: {
      parsed?: {
        type?: string;
        info?: {
          mint?: string;
          tokenAmount?: {
            amount?: string;
            decimals?: number;
          };
        };
      };
    };
  };
};

const assetMaskMap: Record<AssetValue, number> = {
  tokens: 0b001,
  nfts: 0b010,
  daos: 0b100,
};

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SPL_GOVERNANCE_PROGRAM_IDS = [new PublicKey("GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw")];

export const placeholderAssetCounts: AssetCounts = assetCatalog.reduce(
  (counts, asset) => ({
    ...counts,
    [asset.value]: 0,
  }),
  {} as AssetCounts,
);

export const placeholderAssetSnapshot: AssetSnapshot = {
  counts: placeholderAssetCounts,
  tokenMints: [],
  nftCollections: [],
  daoMemberships: [],
  labelsByAssetId: {},
};

export const assetMaskFromSelection = (selected: AssetValue[]) =>
  selected.reduce((mask, asset) => mask | assetMaskMap[asset], 0);

export const selectionFromAssetMask = (mask: number) =>
  assetCatalog.filter((asset) => (mask & assetMaskMap[asset.value]) !== 0).map((asset) => asset.value);

export const sumSelectedAssetCounts = (selected: AssetValue[], assetCounts: AssetCounts) =>
  selected.reduce((sum, asset) => sum + assetCounts[asset], 0);

const toBase58 = (value: PublicKeyLike) => (typeof value === "string" ? value : value.toBase58());

const normalizeMetadataName = (value: string | null | undefined) => value?.replace(/\0/g, "").trim() ?? "";

const buildMetadataAddress = (mint: string) =>
  PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0];

const fetchMetadataLabels = async (connection: Pick<Connection, "getMultipleAccountsInfo">, assetIds: string[]): Promise<AssetLabels> => {
  const uniqueAssetIds = [...new Set(assetIds)];

  if (uniqueAssetIds.length === 0) {
    return {};
  }

  const metadataAddresses = uniqueAssetIds.map(buildMetadataAddress);
  const metadataAccounts = await connection.getMultipleAccountsInfo(metadataAddresses);
  const { getMetadataAccountDataSerializer } = await import("@metaplex-foundation/mpl-token-metadata");
  const serializer = getMetadataAccountDataSerializer();

  return uniqueAssetIds.reduce<AssetLabels>((labels, assetId, index) => {
    const account = metadataAccounts[index];

    if (!account) {
      return labels;
    }

    try {
      const [metadata] = serializer.deserialize(new Uint8Array(account.data));
      const name = normalizeMetadataName(metadata.name);

      if (name) {
        labels[assetId] = name;
      }
    } catch {
      return labels;
    }

    return labels;
  }, {});
};

const fetchDaoMembershipLabels = async (connection: Connection, assetIds: string[]): Promise<AssetLabels> => {
  const uniqueAssetIds = [...new Set(assetIds)];

  if (uniqueAssetIds.length === 0) {
    return {};
  }

  const { getRealm } = await import("@solana/spl-governance");
  const labelEntries = await Promise.all(
    uniqueAssetIds.map(async (assetId) => {
      try {
        const realm = await getRealm(connection, new PublicKey(assetId));
        const name = normalizeMetadataName(realm.account.name);

        return name ? [assetId, name] : null;
      } catch {
        return null;
      }
    }),
  );

  return Object.fromEntries(labelEntries.filter((entry): entry is [string, string] => Boolean(entry)));
};

export const extractTokenMints = (accounts: ParsedTokenAccount[]) =>
  [...new Set(
    accounts.flatMap((account) => {
      const parsed = account.account.data.parsed;

      if (parsed?.type !== "account" || !parsed.info?.mint) {
        return [];
      }

      return [parsed.info.mint];
    }),
  )];

export const extractNftCandidateMints = (accounts: ParsedTokenAccount[]) =>
  [...new Set(
    accounts.flatMap((account) => {
      const parsed = account.account.data.parsed;
      const tokenAmount = parsed?.info?.tokenAmount;

      if (
        parsed?.type !== "account" ||
        !parsed.info?.mint ||
        tokenAmount?.amount !== "1" ||
        tokenAmount.decimals !== 0
      ) {
        return [];
      }

      return [parsed.info.mint];
    }),
  )];

export const extractNftCollectionMints = (nfts: NftCollectionAsset[]) =>
  [...new Set(
    nfts.flatMap((nft) => {
      if (!nft.collection?.verified) {
        return [];
      }

      return [toBase58(nft.collection.address)];
    }),
  )];

export const extractDaoMemberships = (tokenOwnerRecords: TokenOwnerRecordLike[]) =>
  [...new Set(tokenOwnerRecords.map((record) => toBase58(record.account.realm)))];

const findNftsByOwnerWithMetadata: FindNftsByOwner = async (connection, owner) => {
  const candidateAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const nftCandidateMints = extractNftCandidateMints(candidateAccounts.value as ParsedTokenAccount[]);

  if (nftCandidateMints.length === 0) {
    return [];
  }

  const metadataAddresses = nftCandidateMints.map((mint) =>
    PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
      TOKEN_METADATA_PROGRAM_ID,
    )[0],
  );

  const metadataAccounts = await connection.getMultipleAccountsInfo(metadataAddresses);
  const { getMetadataAccountDataSerializer } = await import("@metaplex-foundation/mpl-token-metadata");
  const { unwrapOption } = await import("@metaplex-foundation/umi");
  const serializer = getMetadataAccountDataSerializer();

  return metadataAccounts.flatMap((account) => {
    if (!account) {
      return [];
    }

    try {
      const [metadata] = serializer.deserialize(new Uint8Array(account.data));
      const collection = unwrapOption(metadata.collection);

      if (!collection) {
        return [];
      }

      return [
        {
          collection: {
            address: collection.key,
            verified: collection.verified,
          },
        },
      ];
    } catch {
      return [];
    }
  });
};

const findDaoMembershipsByOwnerWithGovernance: FindDaoMembershipsByOwner = async (connection, owner) => {
  const { getTokenOwnerRecordsByOwner } = await import("@solana/spl-governance");

  const membershipGroups = await Promise.all(
    SPL_GOVERNANCE_PROGRAM_IDS.map(async (programId) => {
      try {
        return (await getTokenOwnerRecordsByOwner(connection, programId, owner)) as TokenOwnerRecordLike[];
      } catch {
        return [];
      }
    }),
  );

  return membershipGroups.flat();
};

export const fetchSplTokenMints = async (
  connection: Pick<Connection, "getParsedTokenAccountsByOwner">,
  walletAddress: string,
) => {
  const owner = new PublicKey(walletAddress);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  return extractTokenMints(tokenAccounts.value as ParsedTokenAccount[]);
};

export const fetchNftCollectionMints = async (
  connection: Connection,
  walletAddress: string,
  findNftsByOwner: FindNftsByOwner = findNftsByOwnerWithMetadata,
) => {
  const owner = new PublicKey(walletAddress);
  const nfts = await findNftsByOwner(connection, owner);

  return extractNftCollectionMints(nfts);
};

export const fetchDaoMemberships = async (
  connection: Connection,
  walletAddress: string,
  findDaoMembershipsByOwner: FindDaoMembershipsByOwner = findDaoMembershipsByOwnerWithGovernance,
) => {
  const owner = new PublicKey(walletAddress);
  const tokenOwnerRecords = await findDaoMembershipsByOwner(connection, owner);

  return extractDaoMemberships(tokenOwnerRecords);
};

export const fetchAssetCounts = async (
  walletAddress: string,
  connection: Connection = solanaConnection,
): Promise<AssetCounts> => {
  const snapshot = await fetchAssetSnapshot(walletAddress, connection);

  return snapshot.counts;
};

export const fetchAssetSnapshot = async (
  walletAddress: string,
  connection: Connection = solanaConnection,
  findNftsByOwner: FindNftsByOwner = findNftsByOwnerWithMetadata,
  findDaoMembershipsByOwner: FindDaoMembershipsByOwner = findDaoMembershipsByOwnerWithGovernance,
  labelResolvers: AssetLabelResolvers = {},
): Promise<AssetSnapshot> => {
  const resolveTokenMintLabels = labelResolvers.resolveTokenMintLabels ?? fetchMetadataLabels;
  const resolveNftCollectionLabels = labelResolvers.resolveNftCollectionLabels ?? fetchMetadataLabels;
  const resolveDaoMembershipLabels = labelResolvers.resolveDaoMembershipLabels ?? fetchDaoMembershipLabels;

  const [tokenResult, nftResult, daoResult] = await Promise.allSettled([
    fetchSplTokenMints(connection, walletAddress),
    fetchNftCollectionMints(connection, walletAddress, findNftsByOwner),
    fetchDaoMemberships(connection, walletAddress, findDaoMembershipsByOwner),
  ]);

  const tokenMints = tokenResult.status === "fulfilled" ? tokenResult.value : [];
  const nftCollections = nftResult.status === "fulfilled" ? nftResult.value : [];
  const daoMemberships = daoResult.status === "fulfilled" ? daoResult.value : [];
  const [tokenLabelResult, nftLabelResult, daoLabelResult] = await Promise.allSettled([
    resolveTokenMintLabels(connection, tokenMints),
    resolveNftCollectionLabels(connection, nftCollections),
    resolveDaoMembershipLabels(connection, daoMemberships),
  ]);

  const labelsByAssetId = {
    ...LOCAL_TOKEN_REGISTRY,
    ...(tokenLabelResult.status === "fulfilled" ? tokenLabelResult.value : {}),
    ...(nftLabelResult.status === "fulfilled" ? nftLabelResult.value : {}),
    ...(daoLabelResult.status === "fulfilled" ? daoLabelResult.value : {}),
  };

  return {
    counts: {
      tokens: tokenMints.length,
      nfts: nftCollections.length,
      daos: daoMemberships.length,
    },
    tokenMints,
    nftCollections,
    daoMemberships,
    labelsByAssetId,
  };
};
