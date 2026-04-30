import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { describe, expect, it, vi } from "vitest";

import {
  connectBrowserWallet,
  createSolanaConnection,
  disconnectBrowserWallet,
  formatWalletAddress,
  getBrowserSolanaProvider,
  getBrowserWalletAddress,
  getInstalledSolanaWallets,
  getSolanaExplorerUrl,
  getSolanaRpcEndpoint,
  hasInstalledWalletProvider,
  signAndSendBrowserTransaction,
} from "@/lib/solana";

describe("solana utilities", () => {
  it("uses a custom RPC endpoint when one is provided", () => {
    expect(getSolanaRpcEndpoint("https://rpc.silentcircle.dev")).toBe("https://rpc.silentcircle.dev");
  });

  it("falls back to Solana devnet when no RPC endpoint is configured", () => {
    expect(getSolanaRpcEndpoint("")).toContain("devnet");
  });

  it("builds devnet and custom explorer URLs", () => {
    expect(getSolanaExplorerUrl("address", "So11111111111111111111111111111111111111112")).toBe(
      "https://explorer.solana.com/address/So11111111111111111111111111111111111111112?cluster=devnet",
    );

    expect(getSolanaExplorerUrl("tx", "5vJ7Jp3UvR1ZJ2x1kYk3mWq7a8T9nP4bQ6rS8uV1xY2", "https://rpc.silentcircle.dev")).toBe(
      "https://explorer.solana.com/tx/5vJ7Jp3UvR1ZJ2x1kYk3mWq7a8T9nP4bQ6rS8uV1xY2?cluster=custom&customUrl=https%3A%2F%2Frpc.silentcircle.dev",
    );
  });

  it("creates a confirmed connection", () => {
    const connection = createSolanaConnection("https://rpc.silentcircle.dev");

    expect(connection.rpcEndpoint).toBe("https://rpc.silentcircle.dev");
    expect(connection.commitment).toBe("confirmed");
  });

  it("discovers installed Solana wallets without duplicating the same provider", () => {
    const phantomProvider = { connect: vi.fn(), disconnect: vi.fn(), isPhantom: true };
    const backpackProvider = { connect: vi.fn(), disconnect: vi.fn(), isBackpack: true };

    expect(getInstalledSolanaWallets({ phantom: { solana: phantomProvider }, backpack: backpackProvider, solana: phantomProvider })).toEqual([
      { id: "phantom", label: "Phantom", provider: phantomProvider },
      { id: "backpack", label: "Backpack", provider: backpackProvider },
    ]);

    expect(getBrowserSolanaProvider({ phantom: { solana: phantomProvider }, backpack: backpackProvider })).toBe(phantomProvider);
    expect(hasInstalledWalletProvider({ phantom: { solana: phantomProvider } })).toBe(true);
  });

  it("falls back to a generic injected wallet label when no known brand is detected", () => {
    const provider = { connect: vi.fn(), disconnect: vi.fn(), name: "Solana Wallet" };

    expect(getInstalledSolanaWallets({ solana: provider })).toEqual([{ id: "injected", label: "Solana Wallet", provider }]);
  });

  it("connects and disconnects through the detected provider", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({ publicKey: { toString: () => "8xJmYp5Qm2nZkS6Lq3M4Y5T6n7P8R9sA" } });
    const provider = { connect, disconnect };

    await expect(connectBrowserWallet(provider)).resolves.toBe("8xJmYp5Qm2nZkS6Lq3M4Y5T6n7P8R9sA");
    expect(connect).toHaveBeenCalledWith({ onlyIfTrusted: false });
    // connectBrowserWallet preemptively calls disconnect to clear any cached
    // trusted session — reset the spy so the next assertion measures only the
    // explicit disconnectBrowserWallet call.
    disconnect.mockClear();

    await disconnectBrowserWallet(provider);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("returns the detected wallet address when available", () => {
    expect(getBrowserWalletAddress({ publicKey: { toString: () => "8xJmYp5Qm2nZkS6Lq3M4Y5T6n7P8R9sA" }, connect: vi.fn() })).toBe(
      "8xJmYp5Qm2nZkS6Lq3M4Y5T6n7P8R9sA",
    );
    expect(getBrowserWalletAddress({ connect: vi.fn() })).toBeNull();
  });

  it("builds and submits a transaction through the detected provider", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "5vJ7Jp3UvR1ZJ2x1kYk3mWq7a8T9nP4bQ6rS8uV1xY2" });
    const confirmTransaction = vi.fn().mockResolvedValue({ value: { err: null } });
    const getLatestBlockhash = vi.fn().mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 123,
    });
    const provider = {
      publicKey: new PublicKey("So11111111111111111111111111111111111111112"),
      connect: vi.fn(),
      signAndSendTransaction,
    };
    const instruction = new TransactionInstruction({
      programId: new PublicKey("11111111111111111111111111111111"),
      keys: [],
      data: Buffer.from([1, 2, 3]),
    });

    await expect(
      signAndSendBrowserTransaction({
        instructions: [instruction],
        provider,
        connection: { getLatestBlockhash, confirmTransaction },
      }),
    ).resolves.toBe("5vJ7Jp3UvR1ZJ2x1kYk3mWq7a8T9nP4bQ6rS8uV1xY2");

    expect(getLatestBlockhash).toHaveBeenCalledWith("confirmed");
    expect(signAndSendTransaction).toHaveBeenCalledOnce();

    const [transaction, options] = signAndSendTransaction.mock.calls[0];
    expect(transaction.feePayer?.toBase58()).toBe("So11111111111111111111111111111111111111112");
    expect(transaction.recentBlockhash).toBe("11111111111111111111111111111111");
    expect(transaction.instructions).toHaveLength(1);
    expect(options).toEqual({ preflightCommitment: "confirmed" });

    expect(confirmTransaction).toHaveBeenCalledWith(
      {
        signature: "5vJ7Jp3UvR1ZJ2x1kYk3mWq7a8T9nP4bQ6rS8uV1xY2",
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 123,
      },
      "confirmed",
    );
  });

  it("rejects transaction submission when the wallet cannot sign", async () => {
    await expect(
      signAndSendBrowserTransaction({
        instructions: [
          new TransactionInstruction({
            programId: new PublicKey("11111111111111111111111111111111"),
            keys: [],
            data: Buffer.alloc(0),
          }),
        ],
        provider: { publicKey: new PublicKey("So11111111111111111111111111111111111111112"), connect: vi.fn() },
        connection: { getLatestBlockhash: vi.fn(), confirmTransaction: vi.fn() },
      }),
    ).rejects.toThrow("cannot sign and send");
  });

  it("formats wallet addresses for compact display", () => {
    expect(formatWalletAddress(null)).toBe("Not connected");
    expect(formatWalletAddress(null, "Waiting")).toBe("Waiting");
    expect(formatWalletAddress("1234567890")).toBe("1234567890");
    expect(formatWalletAddress("8xJmYp5Qm2nZkS6Lq3M4Y5T6n7P8R9sA")).toBe("8xJm…R9sA");
  });
});
