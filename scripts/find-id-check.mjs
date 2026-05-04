/**
 * Find the exact instruction(s) that load the program-id static for the
 * DeclaredProgramIdMismatch check.
 *
 * Approach:
 *  1. Search ALL of .text for lddw instructions that load 0x6a030 (EBohp VMA)
 *  2. Disassemble .text+0x65ef0 (target of first entry-point call)
 *  3. Search for any lddw loading an address that contains 32-byte data resembling a pubkey
 */
import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";

const PROGRAM_ID      = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const PROGRAMDATA_HDR = 45;
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

process.stdout.write("Downloading binary... ");
const progAcct = await conn.getAccountInfo(PROGRAM_ID);
const pdAddr   = new PublicKey(progAcct.data.slice(4, 36));
const pdAcct   = await conn.getAccountInfo(pdAddr);
const elf      = Buffer.from(pdAcct.data.slice(PROGRAMDATA_HDR));
console.log(`done (${elf.length} bytes)`);

// ── ELF sections ──────────────────────────────────────────────────────────────
function parseSections(buf) {
  const e_shoff     = Number(buf.readBigUInt64LE(40));
  const e_shentsize = buf.readUInt16LE(58);
  const e_shnum     = buf.readUInt16LE(60);
  const e_shstrndx  = buf.readUInt16LE(62);
  const strHdrOff   = e_shoff + e_shstrndx * e_shentsize;
  const shstrOffset = Number(buf.readBigUInt64LE(strHdrOff + 24));
  const shstrSize   = Number(buf.readBigUInt64LE(strHdrOff + 32));
  const shstrtab    = buf.slice(shstrOffset, shstrOffset + shstrSize);
  const sections    = {};
  for (let i = 0; i < e_shnum; i++) {
    const hdr       = e_shoff + i * e_shentsize;
    const nameOff   = buf.readUInt32LE(hdr);
    const sh_addr   = Number(buf.readBigUInt64LE(hdr + 16));
    const sh_offset = Number(buf.readBigUInt64LE(hdr + 24));
    const sh_size   = Number(buf.readBigUInt64LE(hdr + 32));
    let name = "";
    let j = nameOff;
    while (j < shstrtab.length && shstrtab[j] !== 0) name += String.fromCharCode(shstrtab[j++]);
    if (name) sections[name] = { offset: sh_offset, size: sh_size, vma: sh_addr };
  }
  return sections;
}

const sec    = parseSections(elf);
const text   = sec[".text"];
const rodata = sec[".rodata"];
const drelro = sec[".data.rel.ro"];

// ── [1] Full-text scan for lddw loading 0x6a030 ──────────────────────────────
// lddw byte layout: [18 rd 00 00 LO_BYTES(4)] [00 r0 00 00 HI_BYTES(4)]
// For 0x6a030: lo=0x0006a030 => bytes[4..8] = 30 a0 06 00, hi=0 => bytes[12..16] = 00 00 00 00
console.log(`\n[1] Scanning ALL of .text (${text.size} bytes) for lddw loading 0x6a030 (EBohp VMA):`);
let found6a030 = 0;
for (let i = 0; i < text.size - 16; i += 8) {
  const base = text.offset + i;
  if (elf[base] !== 0x18) continue;
  const lo = elf.readUInt32LE(base + 4);
  const hi = elf.readUInt32LE(base + 12);
  if (lo === 0x6a030 && hi === 0) {
    const dst = elf[base + 1] & 0x0f;
    console.log(`  .text+0x${i.toString(16).padStart(5,'0')}  lddw r${dst}, 0x6a030  ← EBohp VMA`);
    found6a030++;
  }
}
if (!found6a030) console.log("  (none found — 0x6a030 never loaded by lddw in .text)");

// ── [2] Full-text scan for ANY lddw loading into .rodata range ────────────────
const rodataEnd = rodata.vma + rodata.size;
console.log(`\n[2] All lddw in .text loading a .rodata address (vma 0x${rodata.vma.toString(16)}..0x${rodataEnd.toString(16)}):`);
const rodataRefs = [];
for (let i = 0; i < text.size - 16; i += 8) {
  const base = text.offset + i;
  if (elf[base] !== 0x18) continue;
  const lo   = elf.readUInt32LE(base + 4);
  const hi   = elf.readUInt32LE(base + 12);
  const full = BigInt(lo) | (BigInt(hi) << 32n);
  if (full >= BigInt(rodata.vma) && full < BigInt(rodataEnd)) {
    const dst     = elf[base + 1] & 0x0f;
    const rodOff  = Number(full - BigInt(rodata.vma));
    const slice32 = elf.slice(rodata.offset + rodOff, rodata.offset + rodOff + 32);
    let pk = "(non-pubkey)";
    try { pk = new PublicKey(slice32).toBase58(); } catch {}
    rodataRefs.push({ textOff: i, vma: full, rodOff, pk });
    console.log(`  .text+0x${i.toString(16).padStart(5,'0')}  lddw r${dst}, 0x${full.toString(16)}  → .rodata+${rodOff}  = ${pk.slice(0,20)}...`);
  }
}

// ── [3] Disassemble .text+0x65ef0 (first entry-point call target) ─────────────
function decode(bytes, off, textOffset) {
  const opc    = bytes[0];
  const dst    = bytes[1] & 0x0f;
  const src    = (bytes[1] >> 4) & 0x0f;
  const off16  = bytes.readInt16LE(2);
  const imm32  = bytes.readInt32LE(4);
  const imm32u = bytes.readUInt32LE(4);

  if (opc === 0x18) {
    return { desc: "lddw", wide: true };  // handled outside
  }
  const OPC = {
    0x95: `exit`,
    0xbf: `mov64 r${dst}, r${src}`,
    0xb7: `mov r${dst}, imm=0x${imm32u.toString(16)}`,
    0x07: `add64 r${dst}, imm=${imm32}`,
    0x0f: `add64_x r${dst}, r${src}`,
    0x57: `and64 r${dst}, imm=0x${imm32u.toString(16)}`,
    0x67: `lsh64 r${dst}, imm=${imm32u}`,
    0x77: `rsh64 r${dst}, imm=${imm32u}`,
    0x79: `ldxdw r${dst}, [r${src}${off16>=0?'+':''}${off16}]`,
    0x69: `ldxh r${dst}, [r${src}${off16>=0?'+':''}${off16}]`,
    0x71: `ldxb r${dst}, [r${src}${off16>=0?'+':''}${off16}]`,
    0x61: `ldxw r${dst}, [r${src}${off16>=0?'+':''}${off16}]`,
    0x7b: `stxdw [r${dst}${off16>=0?'+':''}${off16}], r${src}`,
    0x63: `stxw [r${dst}${off16>=0?'+':''}${off16}], r${src}`,
    0x73: `stxb [r${dst}${off16>=0?'+':''}${off16}], r${src}`,
    0x15: `jeq r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0x1d: `jeq_x r${dst}, r${src}, off=${off16}`,
    0x55: `jne r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0x5d: `jne_x r${dst}, r${src}, off=${off16}`,
    0x25: `jgt r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0x2d: `jgt_x r${dst}, r${src}, off=${off16}`,
    0x35: `jge r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0xd5: `jsge r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0x45: `jset r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0xa5: `jlt r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`,
    0x85: `call imm=0x${imm32u.toString(16)} → .text+0x${((off / 8 + 1 + imm32) * 8).toString(16)}`,
  };
  return { desc: OPC[opc] ?? `? opc=0x${opc.toString(16).padStart(2,'0')} dst=${dst} src=${src} off=${off16} imm=0x${imm32u.toString(16)}`, wide: false };
}

function disasm(startOff, numInstr) {
  const lines = [];
  let i = 0;
  let n = 0;
  while (n < numInstr) {
    const off  = startOff + i;
    if (off + 8 > text.size) break;
    const raw  = elf.slice(text.offset + off, text.offset + off + 8);
    const hex  = raw.toString("hex");
    const opc  = raw[0];

    if (opc === 0x18) {
      // lddw — wide
      if (off + 16 > text.size) break;
      const raw2 = elf.slice(text.offset + off + 8, text.offset + off + 16);
      const lo   = raw.readUInt32LE(4);
      const hi   = raw2.readUInt32LE(4);
      const full = BigInt(lo) | (BigInt(hi) << 32n);
      const dst  = raw[1] & 0x0f;
      let extra = "";
      if (rodata && full >= BigInt(rodata.vma) && full < BigInt(rodata.vma + rodata.size)) {
        const rodOff  = Number(full - BigInt(rodata.vma));
        const slice32 = elf.slice(rodata.offset + rodOff, rodata.offset + rodOff + 32);
        let pk = "";
        try { pk = new PublicKey(slice32).toBase58(); } catch {}
        extra = `  ← .rodata+${rodOff}  ${pk ? "→ " + pk.slice(0,20) + "..." : ""}`;
      }
      lines.push(`  +0x${off.toString(16).padStart(5,'0')}: ${hex} ${raw2.toString("hex")}  lddw r${dst}, 0x${full.toString(16)}${extra}`);
      i += 16; n++;
    } else {
      const { desc } = decode(raw, off, text.offset);
      lines.push(`  +0x${off.toString(16).padStart(5,'0')}: ${hex}  ${desc}`);
      i += 8; n++;
    }
  }
  return lines;
}

const firstCallTarget = 0x65ef0;
console.log(`\n[3] Disassembly at .text+0x${firstCallTarget.toString(16)} (entry's first call target, 60 instr):`);
disasm(firstCallTarget, 60).forEach(l => console.log(l));

// ── [4] Full-text scan for lddw loading .data.rel.ro addresses ───────────────
if (drelro) {
  const drelroEnd = drelro.vma + drelro.size;
  console.log(`\n[4] All lddw in .text loading a .data.rel.ro address (vma 0x${drelro.vma.toString(16)}..0x${drelroEnd.toString(16)}) within first 0x70000 bytes of .text:`);
  let cnt = 0;
  for (let i = 0; i < Math.min(0x70000, text.size - 16); i += 8) {
    const base = text.offset + i;
    if (elf[base] !== 0x18) continue;
    const lo   = elf.readUInt32LE(base + 4);
    const hi   = elf.readUInt32LE(base + 12);
    const full = BigInt(lo) | (BigInt(hi) << 32n);
    if (full >= BigInt(drelro.vma) && full < BigInt(drelroEnd)) {
      const dst    = elf[base + 1] & 0x0f;
      const relOff = Number(full - BigInt(drelro.vma));
      console.log(`  .text+0x${i.toString(16).padStart(5,'0')}  lddw r${dst}, 0x${full.toString(16)}  → .data.rel.ro+${relOff}`);
      cnt++;
      if (cnt > 30) { console.log("  (truncated after 30 entries)"); break; }
    }
  }
  if (!cnt) console.log("  (none)");
}

// ── [5] Search .text for immediate value 0x1004 (error 4100) ──────────────────
console.log(`\n[5] Instructions with imm=4100 (0x1004 = DeclaredProgramIdMismatch error code):`);
let errFound = 0;
for (let i = 0; i < text.size - 8; i += 8) {
  const base = text.offset + i;
  const imm  = elf.readUInt32LE(base + 4);
  if (imm === 4100) {
    const opc  = elf[base];
    const dst  = elf[base + 1] & 0x0f;
    const off16 = elf.readInt16LE(base + 2);
    console.log(`  .text+0x${i.toString(16).padStart(5,'0')}  opc=0x${opc.toString(16).padStart(2,'0')} dst=r${dst} off=${off16} imm=4100`);
    errFound++;
  }
}
if (!errFound) console.log("  (none — error code might be computed differently)");

// Also search for 0x6401f400 (ProgramError encoding) or Anchor's encoding
// Anchor encodes error as 6000 + code = 6000+4100 = 10100 = 0x2774? Actually no:
// Anchor error = error_code_number (just 4100) wrapped in ProgramError
// The actual error return value: (6000 + code_offset) in Anchor namespace...
// Actually DeclaredProgramIdMismatch = code 4100 which is raw 4100 in Anchor's numbering
// ProgramError::Custom(4100) => 4100 + (1 << 32)? Let me just search for various encodings.
console.log(`\n[5b] Instructions with imm=0x1004 (same as 4100 but as hex):`);
// same search, already done above

// Search for 6100 = 0x17D4 in case it's offset
for (const errCode of [4100, 6100, 0x1770 + 100, 100]) {
  let cnt2 = 0;
  for (let i = 0; i < text.size - 8; i += 8) {
    if (elf.readUInt32LE(text.offset + i + 4) === errCode) cnt2++;
  }
  if (cnt2) console.log(`  errCode=${errCode} (0x${errCode.toString(16)}) appears ${cnt2} time(s) as imm32`);
}
