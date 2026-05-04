/**
 * THE REAL FIX for DeclaredProgramIdMismatch (error 4100).
 *
 * Root cause: LLVM inlined the compile-time declare_id bytes directly into .text
 * as lddw immediate constants (4 x 8-byte chunks). The previous patch only
 * fixed .rodata, but the comparison in .text still uses the old 2zrc... chunks.
 *
 * This script:
 *   1. Downloads the deployed binary
 *   2. Scans .text for all 4 chunks of 2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk
 *   3. Replaces each with the corresponding chunk of EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq
 *   4. Creates a buffer, uploads the patched ELF, and upgrades the program in-place
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import fs from "node:fs";

const OLD_ID = new PublicKey("2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk");
const NEW_ID = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const BPF_LOADER      = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAMDATA_HDR = 45;
const BUFFER_METADATA = 37;
const CHUNK_SIZE      = 900;

// ── Chunk tables ──────────────────────────────────────────────────────────────
const oldB = Buffer.from(OLD_ID.toBytes());
const newB = Buffer.from(NEW_ID.toBytes());
const patches = [];
for (let i = 0; i < 4; i++) {
  patches.push({
    oldLo: oldB.readUInt32LE(i * 8),
    oldHi: oldB.readUInt32LE(i * 8 + 4),
    newLo: newB.readUInt32LE(i * 8),
    newHi: newB.readUInt32LE(i * 8 + 4),
    idx: i,
  });
  console.log(`Chunk[${i}]: ${oldB.slice(i*8,i*8+8).toString("hex")} -> ${newB.slice(i*8,i*8+8).toString("hex")}`);
}

// ── Download ──────────────────────────────────────────────────────────────────
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
process.stdout.write("\nDownloading binary... ");
const progAcct = await conn.getAccountInfo(NEW_ID);
const pdAddr   = new PublicKey(progAcct.data.slice(4, 36));
const pdAcct   = await conn.getAccountInfo(pdAddr);
const elf      = Buffer.from(pdAcct.data.slice(PROGRAMDATA_HDR));
console.log(`done (${elf.length} bytes)`);

// ── ELF sections ──────────────────────────────────────────────────────────────
const e_shoff     = Number(elf.readBigUInt64LE(40));
const e_shentsize = elf.readUInt16LE(58);
const e_shnum     = elf.readUInt16LE(60);
const e_shstrndx  = elf.readUInt16LE(62);
const strHdrOff   = e_shoff + e_shstrndx * e_shentsize;
const shstrOffset = Number(elf.readBigUInt64LE(strHdrOff + 24));
const shstrSize   = Number(elf.readBigUInt64LE(strHdrOff + 32));
const shstrtab    = elf.slice(shstrOffset, shstrOffset + shstrSize);
const sections    = {};
for (let i = 0; i < e_shnum; i++) {
  const hdr       = e_shoff + i * e_shentsize;
  const nameOff   = elf.readUInt32LE(hdr);
  const sh_addr   = Number(elf.readBigUInt64LE(hdr + 16));
  const sh_offset = Number(elf.readBigUInt64LE(hdr + 24));
  const sh_size   = Number(elf.readBigUInt64LE(hdr + 32));
  let name = ""; let j = nameOff;
  while (j < shstrtab.length && shstrtab[j] !== 0) name += String.fromCharCode(shstrtab[j++]);
  if (name) sections[name] = { offset: sh_offset, size: sh_size };
}
const text   = sections[".text"];
const rodata = sections[".rodata"];

// ── Scan and patch .text ──────────────────────────────────────────────────────
let totalPatched = 0;
const patchLog = [];
for (let i = 0; i <= text.size - 16; i += 8) {
  const base = text.offset + i;
  if (elf[base] !== 0x18) continue;        // not lddw
  if (elf[base + 8] !== 0x00) continue;    // second word must start with 00 (src reg = 0)
  const lo = elf.readUInt32LE(base + 4);
  const hi = elf.readUInt32LE(base + 12);
  for (const p of patches) {
    if (lo === p.oldLo && hi === p.oldHi) {
      const oldFull = (BigInt(p.oldHi) << 32n) | BigInt(p.oldLo);
      const newFull = (BigInt(p.newHi) << 32n) | BigInt(p.newLo);
      patchLog.push(`  .text+0x${i.toString(16).padStart(5,"0")} chunk[${p.idx}]: 0x${oldFull.toString(16)} -> 0x${newFull.toString(16)}`);
      elf.writeUInt32LE(p.newLo, base + 4);
      elf.writeUInt32LE(p.newHi, base + 12);
      totalPatched++;
    }
  }
}

console.log(`\nPatched ${totalPatched} lddw instruction(s) in .text:`);
patchLog.forEach(l => console.log(l));

if (totalPatched === 0) {
  console.error("\nERROR: No patches found — old chunk values not present in .text. Aborting.");
  process.exit(1);
}

// Verify .rodata still has correct ID
const rodataId = elf.slice(rodata.offset + 4192, rodata.offset + 4192 + 32);
const rodataPk = new PublicKey(rodataId).toBase58();
const rodataOk = rodataPk === NEW_ID.toBase58();
console.log(`\n.rodata+4192: ${rodataPk} ${rodataOk ? "(correct ✓)" : "(WRONG — will also fix)"}`);
if (!rodataOk) {
  // Also patch .rodata if needed
  const newIdBytes = Buffer.from(NEW_ID.toBytes());
  newIdBytes.copy(elf, rodata.offset + 4192);
  console.log("  Fixed .rodata+4192");
}

// ── Upload and upgrade ────────────────────────────────────────────────────────
const keypairPath = (process.env.USERPROFILE || process.env.HOME) + "/.config/solana/id.json";
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
);
console.log("\nWallet :", wallet.publicKey.toBase58());
console.log("Balance:", ((await conn.getBalance(wallet.publicKey)) / 1e9).toFixed(4), "SOL");

const bufferKp   = Keypair.generate();
const bufferSize = BUFFER_METADATA + elf.length;
const bufferRent = await conn.getMinimumBalanceForRentExemption(bufferSize);
console.log("Buffer :", bufferKp.publicKey.toBase58());
console.log("Rent   :", (bufferRent / 1e9).toFixed(4), "SOL");

function initBufferIx(buffer, authority) {
  const data = Buffer.alloc(4); data.writeUInt32LE(0);
  return new TransactionInstruction({ programId: BPF_LOADER, keys: [
    { pubkey: buffer,    isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
  ], data });
}

function writeIx(buffer, authority, offset, chunk) {
  const data = Buffer.alloc(4 + 4 + 8 + chunk.length);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(chunk.length), 8);
  Buffer.from(chunk).copy(data, 16);
  return new TransactionInstruction({ programId: BPF_LOADER, keys: [
    { pubkey: buffer,    isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true,  isWritable: false },
  ], data });
}

function upgradeIx(programdata, program, buffer, spill, authority) {
  const data = Buffer.alloc(4); data.writeUInt32LE(3);
  return new TransactionInstruction({ programId: BPF_LOADER, keys: [
    { pubkey: programdata,        isSigner: false, isWritable: true },
    { pubkey: program,            isSigner: false, isWritable: true },
    { pubkey: buffer,             isSigner: false, isWritable: true },
    { pubkey: spill,              isSigner: false, isWritable: true },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY,isSigner: false, isWritable: false },
    { pubkey: authority,          isSigner: true,  isWritable: false },
  ], data });
}

// Create buffer
console.log("\n[1/3] Creating buffer...");
const createTx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: wallet.publicKey, newAccountPubkey: bufferKp.publicKey,
    lamports: bufferRent, space: bufferSize, programId: BPF_LOADER,
  }),
  initBufferIx(bufferKp.publicKey, wallet.publicKey)
);
await sendAndConfirmTransaction(conn, createTx, [wallet, bufferKp]);
console.log("  Buffer created ✓");

// Upload
console.log("[2/3] Uploading patched ELF...");
const totalChunks = Math.ceil(elf.length / CHUNK_SIZE);
for (let i = 0; i < elf.length; i += CHUNK_SIZE) {
  const chunk = elf.slice(i, i + CHUNK_SIZE);
  const n = Math.floor(i / CHUNK_SIZE) + 1;
  await sendAndConfirmTransaction(
    conn, new Transaction().add(writeIx(bufferKp.publicKey, wallet.publicKey, i, chunk)), [wallet]
  );
  if (n % 50 === 0 || n === totalChunks) {
    process.stdout.write(`\r  ${n}/${totalChunks} chunks`);
  }
}
console.log(`\r  ${totalChunks}/${totalChunks} chunks — upload done ✓`);

// Upgrade
console.log("[3/3] Upgrading program in-place...");
const pdAddress = new PublicKey(progAcct.data.slice(4, 36));
const upgradeTx = new Transaction().add(
  upgradeIx(pdAddress, NEW_ID, bufferKp.publicKey, wallet.publicKey, wallet.publicKey)
);
await sendAndConfirmTransaction(conn, upgradeTx, [wallet]);

console.log("\n════════════════════════════════════════════════════════");
console.log("✓  PATCH COMPLETE");
console.log("════════════════════════════════════════════════════════");
console.log("Program (unchanged):", NEW_ID.toBase58());
console.log("Fixed: LLVM-inlined 2zrc... chunks in .text →", totalPatched, "patches");
console.log("\nVerify with: node scripts/test-create-session.mjs");
