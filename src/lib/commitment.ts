import { PublicKey } from "@solana/web3.js";

import type { AssetSnapshot, AssetValue } from "@/lib/assets";

const HASHABLE_ASSET_GROUPS: AssetValue[] = ["tokens", "nfts", "daos"];

export type CommitmentPreview = {
  assetIds: string[];
  assetHashesHex: string[];
  commitmentHex: string;
};

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const concatBytes = (chunks: Uint8Array[]) => {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

const compareByteArrays = (left: Uint8Array, right: Uint8Array) => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return left.length - right.length;
};

const sha256Bytes = async (input: Uint8Array) => new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));

const canonicalizeAssetIds = (assetIds: string[]) => {
  const uniqueIds = [...new Set(assetIds)];

  return uniqueIds.sort((left, right) => compareByteArrays(new PublicKey(left).toBytes(), new PublicKey(right).toBytes()));
};

export const getPendingCommitmentGroups = (selected: AssetValue[]) => selected.filter((asset) => !HASHABLE_ASSET_GROUPS.includes(asset));

export const getHashableAssetIds = (selected: AssetValue[], snapshot: AssetSnapshot) => {
  const assetGroups: Record<AssetValue, string[]> = {
    tokens: snapshot.tokenMints,
    nfts: snapshot.nftCollections,
    daos: snapshot.daoMemberships,
  };

  return canonicalizeAssetIds(selected.filter((asset) => HASHABLE_ASSET_GROUPS.includes(asset)).flatMap((asset) => assetGroups[asset]));
};

export const buildCommitmentPreview = async (assetIds: string[]): Promise<CommitmentPreview> => {
  const canonicalAssetIds = canonicalizeAssetIds(assetIds);

  const assetHashes = await Promise.all(canonicalAssetIds.map(async (assetId) => sha256Bytes(new PublicKey(assetId).toBytes())));
  const commitmentBytes = await sha256Bytes(concatBytes(assetHashes));

  return {
    assetIds: canonicalAssetIds,
    assetHashesHex: assetHashes.map(bytesToHex),
    commitmentHex: bytesToHex(commitmentBytes),
  };
};

export const buildSnapshotCommitmentPreview = (selected: AssetValue[], snapshot: AssetSnapshot) => buildCommitmentPreview(getHashableAssetIds(selected, snapshot));

export const shortenCommitmentHex = (commitmentHex: string, size = 8) => {
  if (commitmentHex.length <= size * 2) {
    return commitmentHex;
  }

  return `${commitmentHex.slice(0, size)}…${commitmentHex.slice(-size)}`;
};
