/**
 * Distributes test tokens to two wallets:
 *   Wallet A (2HS5...): ALPHA, BETA, GAMMA
 *   Wallet B (5PUp...): DELTA, EPSILON
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

const WALLET_A = "2HS5t8Poc6hhDAnFYXrEnRHEH7UW2gKrAzjp1mEuHqbi"; // ALPHA, BETA, GAMMA
const WALLET_B = "5PUpe2ejcY9BeQ4PTeLrUR12ciHjHN5MzFCWojfg2Ne8"; // DELTA, EPSILON

const AMOUNT = 500;

const DISTRIBUTION = [
  { wallet: WALLET_A, tokens: ["ALPHA", "BETA", "GAMMA"] },
  { wallet: WALLET_B, tokens: ["DELTA", "EPSILON"] },
];

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "test-payer.json"), "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log(`Payer: ${payer.publicKey.toBase58()}\n`);

  const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, "test-tokens.json"), "utf8"));
  const tokenMap = Object.fromEntries(tokens.map((t) => [t.name, t]));

  for (const { wallet, tokens: names } of DISTRIBUTION) {
    const recipient = new PublicKey(wallet);
    console.log(`--- Sending to ${wallet.slice(0, 8)}... ---`);

    for (const name of names) {
      const token = tokenMap[name];
      const mint = new PublicKey(token.mint);

      const source = await getOrCreateAssociatedTokenAccount(
        connection, payer, mint, payer.publicKey
      );
      const dest = await getOrCreateAssociatedTokenAccount(
        connection, payer, mint, recipient
      );

      await transfer(
        connection,
        payer,
        source.address,
        dest.address,
        payer,
        AMOUNT * Math.pow(10, token.decimals)
      );

      console.log(`  ✓ ${name}: ${AMOUNT} tokens sent`);
    }
    console.log();
  }

  console.log("Done! Summary:");
  console.log(`  Wallet A (${WALLET_A.slice(0, 8)}...): ALPHA, BETA, GAMMA`);
  console.log(`  Wallet B (${WALLET_B.slice(0, 8)}...): DELTA, EPSILON`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
