/**
 * Transfers all 5 test tokens from the script payer wallet to your Phantom wallet.
 * Usage: node scripts/transfer-tokens-to-wallet.mjs <YOUR_PHANTOM_ADDRESS>
 *
 * Example:
 *   node scripts/transfer-tokens-to-wallet.mjs 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const recipientAddress = process.argv[2];
if (!recipientAddress) {
  console.error("Usage: node scripts/transfer-tokens-to-wallet.mjs <YOUR_PHANTOM_ADDRESS>");
  process.exit(1);
}

const AMOUNT_TO_SEND = 500; // send 500 of each token (keep 500 in payer for Wallet B later)

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load payer keypair
  const keypairPath = path.join(__dirname, "test-payer.json");
  if (!fs.existsSync(keypairPath)) {
    console.error("Payer keypair not found. Run mint-test-tokens.mjs first.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(raw));

  // Load token list
  const tokens = JSON.parse(
    fs.readFileSync(path.join(__dirname, "test-tokens.json"), "utf8")
  );

  const recipient = new PublicKey(recipientAddress);
  console.log(`Sending tokens to: ${recipient.toBase58()}`);
  console.log(`From payer:        ${payer.publicKey.toBase58()}\n`);

  for (const token of tokens) {
    const mint = new PublicKey(token.mint);

    // Source token account (payer's)
    const sourceAccount = await getOrCreateAssociatedTokenAccount(
      connection, payer, mint, payer.publicKey
    );

    // Destination token account (recipient's — created if missing)
    const destAccount = await getOrCreateAssociatedTokenAccount(
      connection, payer, mint, recipient
    );

    const rawAmount = AMOUNT_TO_SEND * Math.pow(10, token.decimals);
    await transfer(
      connection,
      payer,
      sourceAccount.address,
      destAccount.address,
      payer,
      rawAmount
    );

    console.log(`✓ ${token.name} (${token.mint.slice(0, 8)}...)  →  ${AMOUNT_TO_SEND} sent`);
  }

  console.log("\nDone! All 5 tokens transferred.");
  console.log("Now add each token in Phantom using its mint address:");
  tokens.forEach((t) => console.log(`  ${t.name}: ${t.mint}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
