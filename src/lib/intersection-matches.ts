import { selectionFromAssetMask, type AssetSnapshot, type AssetValue } from "@/lib/assets";
import { buildSnapshotCommitmentPreview } from "@/lib/commitment";
import type { SessionAccount } from "@/lib/session-account";

export type IntersectionMatch = {
  id: string;
  assetId: string | null;
  hashHex: string;
  label: string;
  labelSource: "metadata" | "fallback" | "hash";
  type: "Token" | "NFT" | "DAO" | "Unknown";
  detail: string;
};

const shortenPublicKey = (value: string, size = 6) => (value.length <= size * 2 ? value : `${value.slice(0, size)}…${value.slice(-size)}`);

const findAssetGroup = (assetId: string, snapshot: AssetSnapshot): AssetValue | null => {
  if (snapshot.tokenMints.includes(assetId)) {
    return "tokens";
  }

  if (snapshot.nftCollections.includes(assetId)) {
    return "nfts";
  }

  if (snapshot.daoMemberships.includes(assetId)) {
    return "daos";
  }

  return null;
};

const getAssetLabel = (assetId: string, snapshot: AssetSnapshot, fallbackPrefix: string) => snapshot.labelsByAssetId[assetId] ?? `${fallbackPrefix} ${shortenPublicKey(assetId)}`;

const toTypedMatch = (assetId: string | null, hashHex: string, assetGroup: AssetValue | null): IntersectionMatch => {
  switch (assetGroup) {
    case "tokens":
      if (!assetId) {
        break;
      }

      return {
        id: hashHex,
        assetId,
        hashHex,
        label: assetId,
        labelSource: "fallback",
        type: "Token",
        detail: "Shared SPL token mint resolved from the on-chain intersection.",
      };
    case "nfts":
      if (!assetId) {
        break;
      }

      return {
        id: hashHex,
        assetId,
        hashHex,
        label: assetId,
        labelSource: "fallback",
        type: "NFT",
        detail: "Shared verified NFT collection resolved from the on-chain intersection.",
      };
    case "daos":
      if (!assetId) {
        break;
      }

      return {
        id: hashHex,
        assetId,
        hashHex,
        label: assetId,
        labelSource: "fallback",
        type: "DAO",
        detail: "Shared DAO governance realm resolved from the on-chain intersection.",
      };
    default:
      return {
        id: hashHex,
        assetId: null,
        hashHex,
        label: `Hash ${shortenPublicKey(hashHex, 8)}`,
        labelSource: "hash",
        type: "Unknown",
        detail: "Intersection confirmed on-chain, but this client cannot map the hash to a local asset snapshot yet.",
      };
  }
};

export const resolveSessionIntersectionMatches = async (sessionAccount: SessionAccount | null, snapshot: AssetSnapshot): Promise<IntersectionMatch[]> => {
  if (!sessionAccount || sessionAccount.state !== "Done" || sessionAccount.intersectionHashesHex.length === 0) {
    return [];
  }

  const selected = selectionFromAssetMask(sessionAccount.assetMask);
  const preview = await buildSnapshotCommitmentPreview(selected, snapshot);

  // On-chain intersection entries are stored as u64_le padded to [u8; 32]:
  //   first 8 bytes = the matched u64 fingerprint (LE), rest are zeros.
  // The fingerprint is the first 8 bytes of the SHA-256 of each mint.
  // So we match on the first 16 hex chars (8 bytes) of both sides.
  const assetIdByFingerprint = new Map(
    preview?.assetHashesHex.map((hashHex, index) => [hashHex.slice(0, 16), preview.assetIds[index]]) ?? [],
  );

  return sessionAccount.intersectionHashesHex.map((hashHex) => {
    const fingerprint = hashHex.slice(0, 16); // first 8 bytes = u64 fingerprint LE
    const assetId = assetIdByFingerprint.get(fingerprint) ?? null;

    if (!assetId) {
      return toTypedMatch(null, hashHex, null);
    }

    const assetGroup = findAssetGroup(assetId, snapshot);
    const match = toTypedMatch(assetId, hashHex, assetGroup);

    if (match.type === "Token") {
      return {
        ...match,
        label: getAssetLabel(assetId, snapshot, "Mint"),
        labelSource: snapshot.labelsByAssetId[assetId] ? "metadata" : "fallback",
      };
    }

    if (match.type === "NFT") {
      return {
        ...match,
        label: getAssetLabel(assetId, snapshot, "Collection"),
        labelSource: snapshot.labelsByAssetId[assetId] ? "metadata" : "fallback",
      };
    }

    if (match.type === "DAO") {
      return {
        ...match,
        label: getAssetLabel(assetId, snapshot, "Realm"),
        labelSource: snapshot.labelsByAssetId[assetId] ? "metadata" : "fallback",
      };
    }

    return match;
  });
};
