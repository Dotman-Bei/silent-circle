/**
 * Fix the DeclaredProgramIdMismatch (error 4100) in the deployed SilentCircle program.
 *
 * The program at EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq has a stale
 * declare_id! embedded — the ELF patching in the previous session replaced the
 * wrong bytes (PDA seeds / account refs, not the declare_id static in .rodata).
 *
 * This script:
 *   1. Downloads the binary from programdata on devnet
 *   2. Parses the ELF .rodata section and finds the stale declared ID bytes
 *   3. Patches those bytes -> EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq
 *   4. Uploads patched binary to a fresh buffer account
 *   5. Calls BPF Loader Upgradeable UPGRADE (program address stays the same!)
 *
 * Usage:
 *   node scripts/fix-declare-id.mjs
 * Cost: ~0.1–0.3 SOL (buffer rent, refunded after upgrade)
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { ARCIUM_ADDR } from "@arcium-hq/client";
import fs from "node:fs";

const PROGRAM_ID      = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const BPF_LOADER      = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAMDATA_HDR = 45;   // 4 variant + 8 slot + 1 option_tag + 32 authority
const BUFFER_METADATA = 37;   // 4 variant + 1 option_tag + 32 authority
const CHUNK_SIZE      = 900;

// IDs that legitimately appear in the binary — do NOT patch these
const LEGIT_IDS = new Set([
  "11111111111111111111111111111111",                        // System program
  "BPFLoaderUpgradeab1e11111111111111111111111",             // BPF loader
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",           // SPL Token
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bFe",          // Associated Token Account
  "Sysvar1111111111111111111111111111111111111",             // Generic sysvar
  "SysvarRent111111111111111111111111111111111",             // Rent sysvar
  "SysvarC1ock11111111111111111111111111111111",             // Clock sysvar
  "EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq",          // Target — already correct
  ARCIUM_ADDR,                                              // Arcium program
]);

// ── ELF parser (ELF64 LE — the format Solana SBF uses) ───────────────────────
function findRodataRange(buf) {
  // Verify ELF magic
  if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    throw new Error("Not an ELF file");
  }
  if (buf[4] !== 2) throw new Error("Expected ELF64 (class=2)");

  const e_shoff     = Number(buf.readBigUInt64LE(40));
  const e_shentsize = buf.readUInt16LE(58);
  const e_shnum     = buf.readUInt16LE(60);
  const e_shstrndx  = buf.readUInt16LE(62);

  // Read .shstrtab
  const strHdrOff   = e_shoff + e_shstrndx * e_shentsize;
  const shstrOffset = Number(buf.readBigUInt64LE(strHdrOff + 24));
  const shstrSize   = Number(buf.readBigUInt64LE(strHdrOff + 32));
  const shstrtab    = buf.slice(shstrOffset, shstrOffset + shstrSize);

  for (let i = 0; i < e_shnum; i++) {
    const hdr       = e_shoff + i * e_shentsize;
    const nameOff   = buf.readUInt32LE(hdr);
    const sh_offset = Number(buf.readBigUInt64LE(hdr + 24));
    const sh_size   = Number(buf.readBigUInt64LE(hdr + 32));

    let name = "";
    let j = nameOff;
    while (j < shstrtab.length && shstrtab[j] !== 0) {
      name += String.fromCharCode(shstrtab[j++]);
    }
    if (name === ".rodata") return { offset: sh_offset, size: sh_size };
  }
  return null;
}

// ── Scan a buffer for "unknown" embedded pubkeys ──────────────────────────────
function findCandidateIds(elf) {
  let scanBuf   = elf;
  let scanLabel = "full binary";

  try {
    const rodata = findRodataRange(elf);
    if (rodata && rodata.size > 0) {
      scanBuf   = elf.slice(rodata.offset, rodata.offset + rodata.size);
      scanLabel = `.rodata (${rodata.size} bytes at file offset ${rodata.offset})`;
    }
  } catch (e) {
    console.warn("  ELF parse warning:", e.message, "— scanning full binary");
  }
  console.log("  Scanning:", scanLabel);

  // Sliding-window count of every unique 32-byte pattern
  const counts = new Map();
  for (let i = 0; i <= scanBuf.length - 32; i++) {
    const hex = scanBuf.slice(i, i + 32).toString("hex");
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  const candidates = [];
  for (const [hex, count] of counts) {
    const bytes = Buffer.from(hex, "hex");
    if (bytes.every(b => b === 0)) continue;     // skip all-zeros
    if (bytes.every(b => b === 0xff)) continue;  // skip all-0xff

    let pubkey;
    try { pubkey = new PublicKey(bytes).toBase58(); } catch { continue; }

    if (!LEGIT_IDS.has(pubkey)) {
      candidates.push({ pubkey, count, bytes });
    }
  }

  // Sort by occurrence count (fewest first — the declare_id static appears ~once)
  return candidates.sort((a, b) => a.count - b.count);
}

// ── BPF Loader Upgradeable instruction builders ───────────────────────────────
function initBufferIx(buffer, authority) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(0);
  return new TransactionInstruction({
    programId: BPF_LOADER,
    keys: [
      { pubkey: buffer,    isSigner: false, isWritable: true  },
      { pubkey: authority, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function writeIx(buffer, authority, offset, chunk) {
  const data = Buffer.alloc(4 + 4 + 8 + chunk.length);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(chunk.length), 8);
  Buffer.from(chunk).copy(data, 16);
  return new TransactionInstruction({
    programId: BPF_LOADER,
    keys: [
      { pubkey: buffer,    isSigner: false, isWritable: true  },
      { pubkey: authority, isSigner: true,  isWritable: false },
    ],
    data,
  });
}

/** BPF Loader Upgradeable variant 3 — Upgrade an existing program in-place. */
function upgradeIx(programdata, program, buffer, spill, authority) {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(3);
  return new TransactionInstruction({
    programId: BPF_LOADER,
    keys: [
      { pubkey: programdata,           isSigner: false, isWritable: true  },
      { pubkey: program,               isSigner: false, isWritable: true  },
      { pubkey: buffer,                isSigner: false, isWritable: true  },
      { pubkey: spill,                 isSigner: false, isWritable: true  },
      { pubkey: SYSVAR_RENT_PUBKEY,    isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY,   isSigner: false, isWritable: false },
      { pubkey: authority,             isSigner: true,  isWritable: false },
    ],
    data,
  });
}

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
      i += 31;
    }
  }
  return count;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const keypairPath = (process.env.USERPROFILE || process.env.HOME) + "/.config/solana/id.json";
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
  console.log("Wallet  :", wallet.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance :", balance / 1e9, "SOL");
  console.log("Program :", PROGRAM_ID.toBase58(), "\n");

  // ── [1/5] Download binary ──────────────────────────────────────────────────
  console.log("[1/5] Downloading binary from devnet...");
  const programAcct = await connection.getAccountInfo(PROGRAM_ID);
  if (!programAcct) throw new Error("Program account not found");
  if (programAcct.data[0] !== 2) throw new Error("Not a BPF Loader Upgradeable program account");

  const programdataAddress = new PublicKey(programAcct.data.slice(4, 36));
  console.log("  ProgramData :", programdataAddress.toBase58());

  const pdAcct = await connection.getAccountInfo(programdataAddress);
  if (!pdAcct) throw new Error("ProgramData account not found");

  // Check upgrade authority — must be our wallet
  // ProgramData layout: [4 variant][8 slot][1 option_tag][32 authority] = 45 bytes header
  const hasAuthority = pdAcct.data[12] === 1;
  if (hasAuthority) {
    const authority = new PublicKey(pdAcct.data.slice(13, 45));
    console.log("  Authority   :", authority.toBase58());
    if (authority.toBase58() !== wallet.publicKey.toBase58()) {
      throw new Error(`Wallet ${wallet.publicKey.toBase58()} is not the upgrade authority!`);
    }
  } else {
    throw new Error("Program has no upgrade authority (immutable) — cannot upgrade");
  }

  const elf = Buffer.from(pdAcct.data.slice(PROGRAMDATA_HDR));
  console.log("  ELF size    :", elf.length, "bytes\n");

  // ── [2/5] Find stale declare_id ───────────────────────────────────────────
  console.log("[2/5] Scanning for stale declared ID in .rodata...");
  const candidates = findCandidateIds(elf);

  if (candidates.length === 0) {
    console.error("\nNo unknown IDs found in .rodata!");
    console.error("The declare_id may already be correct, or the scan needs adjustment.");
    console.error("Run node scripts/test-create-session.mjs to verify.");
    process.exit(1);
  }

  console.log("\n  Candidate IDs (unknown pubkeys found in .rodata):");
  for (const c of candidates) {
    console.log(`    [${c.count}x] ${c.pubkey}`);
  }

  // The declare_id static appears exactly once in .rodata; pick fewest occurrences
  const oldId = candidates[0];
  console.log("\n  Selected :", oldId.pubkey, `(${oldId.count} occurrence(s) in .rodata)`);

  // ── [3/5] Patch ────────────────────────────────────────────────────────────
  console.log("\n[3/5] Patching ELF...");
  const elfPatched = Buffer.from(elf);
  const newIdBytes = Buffer.from(PROGRAM_ID.toBytes());
  const patchCount = patchBytes(elfPatched, oldId.bytes, newIdBytes);
  console.log("  Patched", patchCount, "occurrence(s) across full binary");

  if (patchCount === 0) {
    console.error("FATAL: patchBytes found 0 occurrences — aborting to avoid bad upgrade.");
    process.exit(1);
  }

  // ── [4/5] Create buffer and upload ────────────────────────────────────────
  console.log("\n[4/5] Creating buffer and uploading patched ELF...");
  const bufferKp   = Keypair.generate();
  const bufferSize = BUFFER_METADATA + elfPatched.length;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);
  console.log("  Buffer :", bufferKp.publicKey.toBase58());
  console.log("  Size   :", bufferSize, "bytes | Rent:", (bufferRent / 1e9).toFixed(4), "SOL");

  const createBufTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey:       wallet.publicKey,
      newAccountPubkey: bufferKp.publicKey,
      lamports:         bufferRent,
      space:            bufferSize,
      programId:        BPF_LOADER,
    }),
    initBufferIx(bufferKp.publicKey, wallet.publicKey)
  );
  await sendAndConfirmTransaction(connection, createBufTx, [wallet, bufferKp]);
  console.log("  Buffer created ✓");

  const totalChunks = Math.ceil(elfPatched.length / CHUNK_SIZE);
  for (let i = 0; i < elfPatched.length; i += CHUNK_SIZE) {
    const chunk    = elfPatched.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const tx = new Transaction().add(writeIx(bufferKp.publicKey, wallet.publicKey, i, chunk));
    await sendAndConfirmTransaction(connection, tx, [wallet]);
    if (chunkNum % 20 === 0 || chunkNum === totalChunks) {
      process.stdout.write(`\r  Uploading: ${chunkNum}/${totalChunks} chunks`);
    }
  }
  console.log(`\r  Uploading: ${totalChunks}/${totalChunks} chunks — done ✓`);

  // ── [5/5] Upgrade in-place ─────────────────────────────────────────────────
  console.log("\n[5/5] Upgrading program in-place (same address, new binary)...");

  const [programdataPda] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBytes()],
    BPF_LOADER
  );
  console.log("  ProgramData PDA:", programdataPda.toBase58());
  if (programdataPda.toBase58() !== programdataAddress.toBase58()) {
    console.warn("  WARNING: Computed PDA differs from account's actual programdata address!");
    console.warn("  Computed  :", programdataPda.toBase58());
    console.warn("  Actual    :", programdataAddress.toBase58());
  }

  const upgradeTx = new Transaction().add(
    upgradeIx(
      programdataAddress,   // actual programdata address (not recomputed PDA, in case of mismatch)
      PROGRAM_ID,
      bufferKp.publicKey,
      wallet.publicKey,     // spill = wallet (receives buffer's rent lamports back)
      wallet.publicKey,     // upgrade authority
    )
  );
  await sendAndConfirmTransaction(connection, upgradeTx, [wallet]);

  console.log("\n════════════════════════════════════════════════════════");
  console.log("✓  FIX COMPLETE");
  console.log("════════════════════════════════════════════════════════");
  console.log("Program ID (unchanged) :", PROGRAM_ID.toBase58());
  console.log("Old stale declare_id   :", oldId.pubkey);
  console.log("Now patched to match   :", PROGRAM_ID.toBase58());
  console.log("\nVerify with:");
  console.log("  node scripts/test-create-session.mjs");
}

main().catch(e => {
  console.error("\nFatal error:", e.message);
  if (e.logs?.length) {
    console.error("Program logs:");
    e.logs.forEach(l => console.error(" ", l));
  }
  process.exit(1);
});
