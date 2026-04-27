import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeSessionAccount, fetchSessionAccount, mapSessionStateToPhase, type SessionAccountState } from "@/lib/session-account";

const SESSION_DISCRIMINATOR = Uint8Array.from([213, 62, 101, 203, 86, 104, 98, 172]);

const encodeU64 = (value: number) => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(value), true);
  return new Uint8Array(buffer);
};

const encodeI64 = (value: number) => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, BigInt(value), true);
  return new Uint8Array(buffer);
};

const encodeU32 = (value: number) => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, true);
  return new Uint8Array(buffer);
};

const concatBytes = (...chunks: Uint8Array[]) => {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
};

const encodeU128 = (value: bigint) => {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setBigUint64(0, value & 0xffffffffffffffffn, true);
  view.setBigUint64(8, value >> 64n, true);
  return new Uint8Array(buffer);
};

const buildSessionData = (state: SessionAccountState) => {
  const stateValue = {
    AwaitingCounterparty: 0,
    BothCommitted: 1,
    Computing: 2,
    Done: 3,
    Expired: 4,
  }[state];

  // Matches the actual Rust Session struct field order (Borsh serialization):
  // wallet_a | wallet_b | commitment_a | commitment_b | arcium_task_id
  // | state | asset_mask | created_at | expires_at | bump | state_nonce | intersection
  return concatBytes(
    SESSION_DISCRIMINATOR,
    new PublicKey("So11111111111111111111111111111111111111112").toBytes(),
    new PublicKey("Vote111111111111111111111111111111111111111").toBytes(),
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
    encodeU64(7),
    Uint8Array.from([stateValue]),
    Uint8Array.from([0b111]),           // asset_mask: u8
    encodeI64(1_745_712_000),           // created_at: i64
    encodeI64(1_745_798_400),           // expires_at: i64
    Uint8Array.from([254]),             // bump: u8
    encodeU128(0n),                     // state_nonce: u128 (skipped in client type)
    encodeU32(2),                       // intersection Vec length prefix
    Uint8Array.from({ length: 64 }, (_, index) => index), // 2 × 32-byte hashes
  );
};

describe("session account utilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes the scaffolded Session account layout", () => {
    const account = decodeSessionAccount("Session1111111111111111111111111111111111", buildSessionData("Computing"));

    expect(account.walletA).toBe("So11111111111111111111111111111111111111112");
    expect(account.walletB).toBe("Vote111111111111111111111111111111111111111");
    expect(account.arciumTaskId).toBe(7);
    expect(account.state).toBe("Computing");
    expect(account.intersectionCount).toBe(2);
    expect(account.intersectionHashesHex).toEqual([
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
    ]);
    expect(account.assetMask).toBe(0b111);
    expect(account.bump).toBe(254);
  });

  it("maps session states onto the UI phase indices", () => {
    expect(mapSessionStateToPhase("AwaitingCounterparty")).toBe(0);
    expect(mapSessionStateToPhase("BothCommitted")).toBe(1);
    expect(mapSessionStateToPhase("Computing")).toBe(2);
    expect(mapSessionStateToPhase("Done")).toBe(3);
    expect(mapSessionStateToPhase("Expired")).toBe(3);
  });

  it("fetches and decodes the session account from the derived PDA", async () => {
    vi.spyOn(PublicKey, "findProgramAddress").mockResolvedValue([new PublicKey("So11111111111111111111111111111111111111112"), 255]);

    const getAccountInfo = vi.fn().mockResolvedValue({
      owner: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      data: buildSessionData("BothCommitted"),
    });

    const account = await fetchSessionAccount(
      "An6UebxCZd",
      { getAccountInfo },
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    );

    expect(account?.state).toBe("BothCommitted");
    expect(getAccountInfo).toHaveBeenCalledOnce();
  });
});