/**
 * Re-deploy SilentCircle to a new program ID, then re-initialize the MXE
 * for cluster 456 with our wallet as authority.
 *
 * Does NOT require Rust, Anchor CLI, or Solana CLI.
 * Reads the existing compiled binary from devnet, patches the program ID,
 * and deploys it via web3.js + BPF Loader Upgradeable instructions.
 *
 * Usage:
 *   node scripts/deploy-new-program.mjs --keypair ~/.config/solana/id.json
 *
 * Cost: ~1.5–2 SOL (program data rent; buffer rent is refunded after deploy)
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction,
         TransactionInstruction, sendAndConfirmTransaction,
         SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import pkg from "@coral-xyz/anchor";
const { AnchorProvider, setProvider, BN } = pkg;
import { ARCIUM_ADDR, initMxePart1, initMxePart2,
         getMXEAccAddress, getClusterAccAddress,
         getFeePoolAccAddress, getClockAccAddress } from "@arcium-hq/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Constants ──────────────────────────────────────────────────────────────────
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const OLD_PROGRAM_ID         = new PublicKey("2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk");
const ARCIUM_PROGRAM_ID      = new PublicKey(ARCIUM_ADDR);
const CLUSTER_456            = 456;

// BPF Loader Upgradeable account layout sizes
const BUFFER_METADATA   = 37;   // 4 variant + 1 option tag + 32 authority
const PROGRAMDATA_HDR   = 45;   // 4 variant + 8 slot + 1 option tag + 32 authority
const PROGRAM_SIZE      = 36;   // 4 variant + 32 programdata_address
const CHUNK_SIZE        = 900;  // safe write-per-tx chunk (fits in 1232-byte tx limit)

// ── BPF Loader Upgradeable instruction builders ────────────────────────────────

/** InitializeBuffer: marks a freshly-created account as a program buffer. */
function initBufferIx(buffer, authority) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(0);   // InitializeBuffer variant
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE,
    keys: [
      { pubkey: buffer,    isSigner: false, isWritable: true  },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Write: upload one chunk of ELF data to the buffer at the given byte offset. */
function writeIx(buffer, authority, offset, chunk) {
  const data = Buffer.alloc(4 + 4 + 8 + chunk.length);
  data.writeUInt32LE(1, 0);                          // Write variant
  data.writeUInt32LE(offset, 4);                     // offset into ELF
  data.writeBigUInt64LE(BigInt(chunk.length), 8);    // Vec<u8> len (bincode u64)
  Buffer.from(chunk).copy(data, 16);
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE,
    keys: [
      { pubkey: buffer,    isSigner: false, isWritable: true  },
      { pubkey: authority, isSigner: true,  isWritable: false },
    ],
    data,
  });
}

/** DeployWithMaxDataLen: consume the buffer and write the program to chain. */
function deployIx(payer, programdata, program, buffer, authority, maxDataLen) {
  const data = Buffer.alloc(4 + 8);
  data.writeUInt32LE(2, 0);                          // DeployWithMaxDataLen variant
  data.writeBigUInt64LE(BigInt(maxDataLen), 4);      // max_data_len (bincode usize=u64)
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE,
    keys: [
      { pubkey: payer,             isSigner: true,  isWritable: true  },
      { pubkey: programdata,       isSigner: false, isWritable: true  },
      { pubkey: program,           isSigner: false, isWritable: true  },
      { pubkey: buffer,            isSigner: false, isWritable: true  },
      { pubkey: SYSVAR_RENT_PUBKEY,  isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: authority,         isSigner: true,  isWritable: false },
    ],
    data,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Replace every occurrence of oldBytes with newBytes in buf (in-place). */
function patchBytes(buf, oldBytes, newBytes) {
  let count = 0;
  for (let i = 0; i <= buf.length - 32; i++) {
    let match = true;
    for (let j = 0; j < 32; j++) {
      if (buf[i + j] !== oldBytes[j]) { match = false; break; }
    }
    if (match) {
      newBytes.copy(buf, i);
      count++;
      i += 31; // skip past the match
    }
  }
  return count;
}

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { opts[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return opts;
};

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.keypair) {
    console.error("Usage: node scripts/deploy-new-program.mjs --keypair ~/.config/solana/id.json");
    process.exit(1);
  }

  const keypairPath = opts.keypair.replace(/^~/, process.env.USERPROFILE || process.env.HOME);
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
  console.log("Wallet:", wallet.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  if (balance < 2e9) {
    console.error("⚠️  Need ≥2 SOL for deployment. Fund wallet:", wallet.publicKey.toBase58());
    process.exit(1);
  }

  // ── Step 1: Read compiled ELF from the existing program on devnet ────────────
  console.log("\n[1/6] Reading program binary from devnet...");
  const programAcct = await connection.getAccountInfo(OLD_PROGRAM_ID);
  if (!programAcct) { console.error("Old program not found on devnet"); process.exit(1); }

  // Program account layout: [variant u32 (=2), programdata_pubkey 32 bytes]
  const programdataAddress = new PublicKey(programAcct.data.slice(4, 36));
  console.log("     ProgramData:", programdataAddress.toBase58());

  const pdAcct = await connection.getAccountInfo(programdataAddress);
  if (!pdAcct) { console.error("ProgramData account not found"); process.exit(1); }

  // ProgramData layout: [4 variant + 8 slot + 1 option_tag + 32 authority = 45 bytes], then ELF
  const elfOriginal = Buffer.from(pdAcct.data.slice(PROGRAMDATA_HDR));
  console.log("     ELF size:", elfOriginal.length, "bytes");

  // ── Step 2: Generate new program keypair and patch ELF ───────────────────────
  console.log("\n[2/6] Generating new program keypair and patching ELF...");
  const newProgramKp   = Keypair.generate();
  const newProgramId   = newProgramKp.publicKey;

  const elfPatched = Buffer.from(elfOriginal); // copy
  const oldIdBytes = Buffer.from(OLD_PROGRAM_ID.toBytes());
  const newIdBytes = Buffer.from(newProgramId.toBytes());
  const patchCount = patchBytes(elfPatched, oldIdBytes, newIdBytes);

  console.log("     New program ID:", newProgramId.toBase58());
  console.log("     Patched", patchCount, "occurrence(s) of old ID in ELF");

  if (patchCount === 0) {
    console.warn("⚠️  WARNING: old program ID not found in ELF. The program may reject calls.");
  }

  // Save new keypair for future reference
  const newKpPath = path.join(__dirname, "..", "target", "deploy", "silent_circle-keypair.json");
  fs.writeFileSync(newKpPath, JSON.stringify(Array.from(newProgramKp.secretKey)));
  console.log("     Keypair saved to target/deploy/silent_circle-keypair.json");

  // ── Step 3: Create and initialize buffer account ─────────────────────────────
  console.log("\n[3/6] Creating buffer account...");
  const bufferKp   = Keypair.generate();
  const bufferSize = BUFFER_METADATA + elfPatched.length;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);
  console.log("     Buffer:", bufferKp.publicKey.toBase58());
  console.log("     Size:", bufferSize, "bytes | Rent:", (bufferRent / 1e9).toFixed(4), "SOL");

  const createBufTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey:         wallet.publicKey,
      newAccountPubkey:   bufferKp.publicKey,
      lamports:           bufferRent,
      space:              bufferSize,
      programId:          BPF_LOADER_UPGRADEABLE,
    }),
    initBufferIx(bufferKp.publicKey, wallet.publicKey)
  );
  await sendAndConfirmTransaction(connection, createBufTx, [wallet, bufferKp]);
  console.log("     ✓ Buffer created");

  // ── Step 4: Write ELF to buffer in chunks ────────────────────────────────────
  console.log("\n[4/6] Uploading ELF to buffer...");
  const totalChunks = Math.ceil(elfPatched.length / CHUNK_SIZE);
  for (let i = 0; i < elfPatched.length; i += CHUNK_SIZE) {
    const chunk    = elfPatched.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const tx = new Transaction().add(writeIx(bufferKp.publicKey, wallet.publicKey, i, chunk));
    await sendAndConfirmTransaction(connection, tx, [wallet]);
    if (chunkNum % 25 === 0 || chunkNum === totalChunks) {
      process.stdout.write(`\r     ${chunkNum}/${totalChunks} chunks (${Math.round(i / elfPatched.length * 100)}%)`);
    }
  }
  console.log("\n     ✓ ELF uploaded");

  // ── Step 5: Deploy buffer to new program ID ───────────────────────────────────
  console.log("\n[5/6] Deploying to new program ID...");
  const [programdataPda] = PublicKey.findProgramAddressSync(
    [newProgramId.toBytes()],
    BPF_LOADER_UPGRADEABLE
  );
  const programRent     = await connection.getMinimumBalanceForRentExemption(PROGRAM_SIZE);
  const programdataRent = await connection.getMinimumBalanceForRentExemption(PROGRAMDATA_HDR + elfPatched.length);
  console.log("     ProgramData PDA:", programdataPda.toBase58());
  console.log("     ProgramData rent:", (programdataRent / 1e9).toFixed(4), "SOL");

  // Create program account + deploy in one tx (program keypair signs both)
  const deployTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey:       wallet.publicKey,
      newAccountPubkey: newProgramId,
      lamports:         programRent,
      space:            PROGRAM_SIZE,
      programId:        BPF_LOADER_UPGRADEABLE,
    }),
    deployIx(
      wallet.publicKey,
      programdataPda,
      newProgramId,
      bufferKp.publicKey,
      wallet.publicKey,
      elfPatched.length
    )
  );
  await sendAndConfirmTransaction(connection, deployTx, [wallet, newProgramKp]);
  console.log("     ✓ Program deployed!");

  // ── Step 6: Initialize MXE for new program with cluster 456 ──────────────────
  console.log("\n[6/6] Initializing MXE for new program (cluster 456)...");
  const provider = new AnchorProvider(connection, {
    publicKey: wallet.publicKey,
    signTransaction:     async (tx) => { tx.partialSign(wallet); return tx; },
    signAllTransactions: async (txs) => txs.map(tx => { tx.partialSign(wallet); return tx; }),
  }, { commitment: "confirmed" });
  setProvider(provider);

  const newMxe = getMXEAccAddress(newProgramId);
  console.log("     New MXE PDA:", newMxe.toBase58());

  try {
    await initMxePart1(provider, newProgramId, { commitment: "confirmed" });
    console.log("     ✓ initMxePart1 done");
  } catch (e) {
    console.error("     initMxePart1 error:", e.message);
    if (e.logs) console.error(e.logs.join("\n"));
    process.exit(1);
  }

  // For initMxePart2 we need a LUT slot — use the current slot
  const lutOffsetSlot = BigInt(await connection.getSlot("confirmed"));
  const keygenOffset          = BigInt(Date.now()); // unique offset for new keygen computation
  const keyRecoveryInitOffset = keygenOffset + 1n;

  try {
    await initMxePart2(
      provider,
      CLUSTER_456,
      newProgramId,
      [],                                       // recovery peers
      new BN(keygenOffset.toString()),
      new BN(keyRecoveryInitOffset.toString()),
      new BN(lutOffsetSlot.toString()),
      wallet.publicKey,                         // our wallet as authority
      { commitment: "confirmed" }
    );
    console.log("     ✓ initMxePart2 done — MXE initialized for cluster 456!");
  } catch (e) {
    console.error("     initMxePart2 error:", e.message);
    if (e.logs) console.error(e.logs.join("\n"));
    process.exit(1);
  }

  // ── Summary ────────────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════");
  console.log("✓ DEPLOYMENT COMPLETE");
  console.log("════════════════════════════════════════════════════");
  console.log("New program ID:", newProgramId.toBase58());
  console.log("New MXE:       ", newMxe.toBase58());
  console.log("Authority:     ", wallet.publicKey.toBase58());
  console.log("\nUpdate these files with the new program ID:");
  console.log("  programs/silent_circle/src/lib.rs  →  declare_id!(\"" + newProgramId.toBase58() + "\")");
  console.log("  Anchor.toml                        →  silent_circle = \"" + newProgramId.toBase58() + "\"");
  console.log("  .env.local                         →  VITE_SILENT_CIRCLE_PROGRAM_ID=" + newProgramId.toBase58());
  console.log("  .env.local                         →  VITE_ARCIUM_MXE_PUBKEY=" + newMxe.toBase58());
  console.log("\nThen wait ~2 min for keygen, then run:");
  console.log("  node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step check");
}

main().catch(e => { console.error("Fatal:", e.message); if (e.logs) console.error(e.logs.join("\n")); process.exit(1); });
