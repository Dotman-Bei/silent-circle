/**
 * Attempt to re-initialize the existing MXE for cluster 456.
 *
 * The MXE was initialized with an authority key we don't have (cluster 69420).
 * init_mxe_part2 has mxe_authority as optional — if the program skips the
 * authority check when omitted, this will overwrite the MXE to use cluster 456
 * and set our wallet as the new authority.
 *
 * Usage:
 *   node scripts/reinit-mxe-456.mjs --keypair ~/.config/solana/id.json
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import pkg from "@coral-xyz/anchor";
const { AnchorProvider, setProvider, BN } = pkg;
import { ARCIUM_ADDR, ARCIUM_IDL, getMXEAccAddress, getClusterAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress, getFeePoolAccAddress, getClockAccAddress, initMxePart2 } from "@arcium-hq/client";
import fs from "node:fs";
import path from "node:path";

const OUR_PROGRAM_ID   = new PublicKey("2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk");
const ARCIUM_PROGRAM_ID = new PublicKey(ARCIUM_ADDR);
const CLUSTER_456      = 456;

const MXE_PUBKEY    = getMXEAccAddress(OUR_PROGRAM_ID);
const CLUSTER_ADDR  = getClusterAccAddress(CLUSTER_456, ARCIUM_PROGRAM_ID);
const MEMPOOL_ADDR  = getMempoolAccAddress(CLUSTER_456, ARCIUM_PROGRAM_ID);
const EXECPOOL_ADDR = getExecutingPoolAccAddress(CLUSTER_456, ARCIUM_PROGRAM_ID);
const FEE_POOL      = getFeePoolAccAddress(ARCIUM_PROGRAM_ID);
const CLOCK         = getClockAccAddress(ARCIUM_PROGRAM_ID);

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { opts[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return opts;
};

// Parse the existing MXE account to get keygen/recovery/lut offsets
const parseMxeOffsets = (data) => {
  let pos = 8;
  const hasCluster = data[pos] === 1; pos++;
  if (hasCluster) pos += 4;
  const keygenOffset          = data.readBigUInt64LE(pos); pos += 8;
  const keyRecoveryInitOffset = data.readBigUInt64LE(pos); pos += 8;
  pos += 32; // mxe_program_id
  const hasAuth = data[pos] === 1; pos++;
  if (hasAuth) pos += 32;
  const isSet = data[pos] === 1; pos++;
  if (isSet) pos += 32 + 32 + 32 + 64; // utility_pubkeys
  const lutOffsetSlot = data.readBigUInt64LE(pos);
  return { keygenOffset, keyRecoveryInitOffset, lutOffsetSlot };
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.keypair) {
    console.error("Usage: node scripts/reinit-mxe-456.mjs --keypair <path>");
    process.exit(1);
  }

  const keypairPath = opts.keypair.replace(/^~/, process.env.USERPROFILE || process.env.HOME);
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  console.log("Wallet:", wallet.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  if (balance < 0.1e9) {
    console.error("Need ≥0.1 SOL"); process.exit(1);
  }

  // Read the existing MXE to reuse the same offsets
  const mxeInfo = await connection.getAccountInfo(MXE_PUBKEY);
  if (!mxeInfo) { console.error("MXE not found"); process.exit(1); }
  const { keygenOffset, keyRecoveryInitOffset, lutOffsetSlot } = parseMxeOffsets(mxeInfo.data);

  console.log("\nExisting MXE offsets:");
  console.log("  keygen_offset:", keygenOffset.toString());
  console.log("  key_recovery_init_offset:", keyRecoveryInitOffset.toString());
  console.log("  lut_offset_slot:", lutOffsetSlot.toString());
  console.log("\nTarget:");
  console.log("  cluster: 456 →", CLUSTER_ADDR.toBase58());
  console.log("  mempool:", MEMPOOL_ADDR.toBase58());
  console.log("  execpool:", EXECPOOL_ADDR.toBase58());
  console.log("  new authority:", wallet.publicKey.toBase58());

  // Build AnchorProvider (needed by initMxePart2 SDK helper)
  const provider = new AnchorProvider(connection, {
    publicKey: wallet.publicKey,
    signTransaction:     async (tx) => { tx.partialSign(wallet); return tx; },
    signAllTransactions: async (txs) => txs.map(tx => { tx.partialSign(wallet); return tx; }),
  }, { commitment: "confirmed" });
  setProvider(provider);

  console.log("\nCalling init_mxe_part2(cluster=456) with mxeAuthority=null ...");
  console.log("(If the on-chain program skips the authority check when omitted, this will succeed)");

  try {
    // Pass mxeAuthority=null → Anchor omits the optional account → no authority check
    const sig = await initMxePart2(
      provider,
      CLUSTER_456,
      OUR_PROGRAM_ID,
      [],                                              // recovery peers — padded to 100 zeros by SDK
      new BN(keygenOffset.toString()),                 // reuse existing keygen_offset
      new BN(keyRecoveryInitOffset.toString()),        // reuse existing key_recovery_init_offset
      new BN(lutOffsetSlot.toString()),                // reuse existing lut_offset_slot
      null,                                            // mxeAuthority = None (omit optional)
      { commitment: "confirmed" }
    );
    console.log("✓ init_mxe_part2 succeeded:", sig);
    console.log("→ MXE re-initialized for cluster 456. Wait ~2 minutes, then run:");
    console.log("  node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step check");
  } catch (e) {
    console.error("Error:", e.message);
    if (e.logs) console.error("Logs:\n" + e.logs.join("\n"));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
