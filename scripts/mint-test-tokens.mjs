/**
 * Mints 5 devnet SPL tokens and saves their mint addresses to scripts/test-tokens.json
 * Usage: node scripts/mint-test-tokens.mjs
 */

import {
  Connection,
  Keypair,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN_NAMES = [
  "ALPHA",
  "BETA",
  "GAMMA",
  "DELTA",
  "EPSILON",
];

const MINT_AMOUNT = 1_000; // tokens per mint (with 6 decimals = 1000.000000)
const DECIMALS = 6;

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load or generate a payer keypair
  const keypairPath = path.join(__dirname, "test-payer.json");
  let payer;

  if (fs.existsSync(keypairPath)) {
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(raw));
    console.log("Loaded existing payer:", payer.publicKey.toBase58());
  } else {
    payer = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(payer.secretKey)));
    console.log("Generated new payer:", payer.publicKey.toBase58());
  }

  // Check and top up balance
  let balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("Low balance — attempting airdrop (trying 3 times with 0.5 SOL each)...");
    let airdropped = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sig = await connection.requestAirdrop(payer.publicKey, 0.5 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        airdropped = true;
        console.log(`  Airdrop attempt ${attempt} succeeded`);
      } catch {
        console.log(`  Airdrop attempt ${attempt} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    balance = await connection.getBalance(payer.publicKey);
    if (balance < 0.5 * LAMPORTS_PER_SOL) {
      console.error(`\nAirdrop failed. Please fund this address manually:`);
      console.error(`  Address : ${payer.publicKey.toBase58()}`);
      console.error(`  Faucet  : https://faucet.solana.com`);
      console.error(`\nThen re-run: node scripts/mint-test-tokens.mjs`);
      process.exit(1);
    }
    console.log(`New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  }

  const results = [];

  for (let i = 0; i < TOKEN_NAMES.length; i++) {
    const name = TOKEN_NAMES[i];
    console.log(`\n[${i + 1}/5] Minting token: ${name}`);

    // Create the mint
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey, // mint authority
      null,            // freeze authority (none)
      DECIMALS,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`  Mint address: ${mint.toBase58()}`);

    // Create associated token account
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey
    );
    console.log(`  Token account: ${tokenAccount.address.toBase58()}`);

    // Mint tokens
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount.address,
      payer,
      MINT_AMOUNT * Math.pow(10, DECIMALS)
    );
    console.log(`  Minted: ${MINT_AMOUNT} ${name}`);

    results.push({
      name,
      mint: mint.toBase58(),
      tokenAccount: tokenAccount.address.toBase58(),
      amount: MINT_AMOUNT,
      decimals: DECIMALS,
    });
  }

  // Save results
  const outPath = path.join(__dirname, "test-tokens.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  console.log("\n✓ Done! All 5 tokens minted.");
  console.log(`  Saved to: scripts/test-tokens.json`);
  console.log(`  Payer wallet: ${payer.publicKey.toBase58()}`);
  console.log("\nToken summary:");
  results.forEach((t) => console.log(`  ${t.name}: ${t.mint}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
