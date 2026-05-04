/**
 * Smoke-tests create_session by building and simulating the tx with the
 * CLI keypair, printing any program logs so we can see the real error.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";
import fs from "node:fs";

const PROGRAM_ID = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

const keypairPath = (process.env.USERPROFILE || process.env.HOME) + "/.config/solana/id.json";
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
console.log("Wallet:", wallet.publicKey.toBase58());
console.log("Balance:", (await conn.getBalance(wallet.publicKey)) / 1e9, "SOL\n");

// ── helpers ──────────────────────────────────────────────────────────────────
const sha256 = async (data) =>
  new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));

const toBytes = (...chunks) => {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
};

// ── discriminator: SHA-256("global:create_session")[0..8] ────────────────────
const discriminator = (await sha256(new TextEncoder().encode("global:create_session"))).slice(0, 8);

// ── session ID: 8 random bytes ────────────────────────────────────────────────
const sessionId = new Uint8Array(8);
crypto.getRandomValues(sessionId);

// ── commitment: SHA-256 of empty (placeholder) ───────────────────────────────
const commitment = await sha256(new Uint8Array(0)); // 32 bytes

// ── asset_mask: u8 ────────────────────────────────────────────────────────────
const assetMask = new Uint8Array([0b111]);

// ── expires_at: i64 LE — 24h from now ────────────────────────────────────────
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
const expiresAtBuf = new ArrayBuffer(8);
new DataView(expiresAtBuf).setBigInt64(0, expiresAt, true);

// ── instruction data ──────────────────────────────────────────────────────────
const data = toBytes(discriminator, sessionId, commitment, assetMask, new Uint8Array(expiresAtBuf));
console.log("Discriminator:", Buffer.from(discriminator).toString("hex"));
console.log("Instruction data length:", data.length, "bytes");

// ── PDA ───────────────────────────────────────────────────────────────────────
const [sessionPda, bump] = await PublicKey.findProgramAddress(
  [new TextEncoder().encode("session"), sessionId],
  PROGRAM_ID,
);
console.log("Session PDA:", sessionPda.toBase58(), "bump:", bump);

// ── Simulate ──────────────────────────────────────────────────────────────────
const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: wallet.publicKey, isSigner: true,  isWritable: true  },
    { pubkey: sessionPda,       isSigner: false, isWritable: true  },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(data),
});

const bh = await conn.getLatestBlockhash("confirmed");
const tx = new Transaction();
tx.feePayer = wallet.publicKey;
tx.recentBlockhash = bh.blockhash;
tx.add(ix);
tx.sign(wallet);

console.log("\n── Sending (with preflight logs) ───────────────────────────────");
try {
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  console.log("✓ create_session confirmed:", sig);
} catch (e) {
  console.error("✗ Error:", e.message);
  if (e.logs?.length) {
    console.error("Program logs:");
    e.logs.forEach(l => console.error(" ", l));
  }
  // Also try to get the tx logs via getTransaction if it landed
  if (e.signature) {
    const detail = await conn.getTransaction(e.signature, { commitment: "confirmed" });
    detail?.meta?.logMessages?.forEach(l => console.error(" ", l));
  }
}
