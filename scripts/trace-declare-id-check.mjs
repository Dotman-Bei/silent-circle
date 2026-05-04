/**
 * Trace the exact SBF instructions that perform the DeclaredProgramIdMismatch check.
 * Strategy:
 *  1. Parse ELF section layout
 *  2. Scan .rodata at 8-byte aligned offsets for ALL known program IDs (old + new)
 *  3. Disassemble .text at +0x2d2f0 (target of entry point's first call) for 80 instructions
 *  4. Also find every lddw instruction whose fully-assembled imm64 falls in .rodata VMA range
 *     → that gives us every .rodata address loaded in the entry / check functions
 *  5. Print bytes at those addresses so we can see what program ID is embedded
 */
import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";

const PROGRAM_ID     = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const PROGRAMDATA_HDR = 45;
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

// ── Download ──────────────────────────────────────────────────────────────────
process.stdout.write("Downloading binary... ");
const progAcct = await conn.getAccountInfo(PROGRAM_ID);
const pdAddr   = new PublicKey(progAcct.data.slice(4, 36));
const pdAcct   = await conn.getAccountInfo(pdAddr);
const elf      = Buffer.from(pdAcct.data.slice(PROGRAMDATA_HDR));
console.log(`done (${elf.length} bytes)`);

// ── ELF section parser ─────────────────────────────────────────────────────
function parseSections(buf) {
  const e_shoff     = Number(buf.readBigUInt64LE(40));
  const e_shentsize = buf.readUInt16LE(58);
  const e_shnum     = buf.readUInt16LE(60);
  const e_shstrndx  = buf.readUInt16LE(62);

  const strHdrOff   = e_shoff + e_shstrndx * e_shentsize;
  const shstrOffset = Number(buf.readBigUInt64LE(strHdrOff + 24));
  const shstrSize   = Number(buf.readBigUInt64LE(strHdrOff + 32));
  const shstrtab    = buf.slice(shstrOffset, shstrOffset + shstrSize);

  const sections = {};
  for (let i = 0; i < e_shnum; i++) {
    const hdr       = e_shoff + i * e_shentsize;
    const nameOff   = buf.readUInt32LE(hdr);
    const sh_addr   = Number(buf.readBigUInt64LE(hdr + 16));
    const sh_offset = Number(buf.readBigUInt64LE(hdr + 24));
    const sh_size   = Number(buf.readBigUInt64LE(hdr + 32));

    let name = "";
    let j = nameOff;
    while (j < shstrtab.length && shstrtab[j] !== 0) {
      name += String.fromCharCode(shstrtab[j++]);
    }
    if (name) sections[name] = { offset: sh_offset, size: sh_size, vma: sh_addr };
  }
  return sections;
}

const sec    = parseSections(elf);
const text   = sec[".text"];
const rodata = sec[".rodata"];
const drelro = sec[".data.rel.ro"] ?? sec[".data.rel.ro.local"];

console.log(`\nSections:`);
for (const [n, s] of Object.entries(sec)) {
  console.log(`  ${n.padEnd(20)} vma=0x${s.vma.toString(16).padStart(8,'0')}  fileOff=${s.offset}  size=${s.size}`);
}

// ── [1] Scan .rodata at 8-byte aligned positions for ALL program IDs ──────────
const KNOWN = {
  "11111111111111111111111111111111":                 "SystemProgram",
  "63CgPfSVhEgg4Gvrq6E8FUbG68awnnmvUai64hqzsgdb":   "OldID-63Cg",
  "2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk":   "OldID-2zrc",
  "EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq":   "TARGET-EBohp",
  "BPFLoaderUpgradeab1e11111111111111111111111":       "BPFLoader",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA":     "SplToken",
  "SysvarRent111111111111111111111111111111111":       "SysvarRent",
  "SysvarC1ock11111111111111111111111111111111":       "SysvarClock",
};

console.log(`\n[1] Scanning .rodata (${rodata.size} bytes, vma=0x${rodata.vma.toString(16)}) at 8-byte aligned positions:`);
const rodataSlice = elf.slice(rodata.offset, rodata.offset + rodata.size);
const rodataHits = [];
for (let i = 0; i + 32 <= rodataSlice.length; i += 8) {
  const bytes  = rodataSlice.slice(i, i + 32);
  if (bytes.every(b => b === 0)) continue;
  let pubkey;
  try { pubkey = new PublicKey(bytes).toBase58(); } catch { continue; }
  const label = KNOWN[pubkey];
  if (label) {
    const vma = rodata.vma + i;
    console.log(`  rodataOff=${i.toString().padStart(6)} vma=0x${vma.toString(16).padStart(8,'0')}: ${pubkey}  [${label}]`);
    rodataHits.push({ i, vma, pubkey, label });
  }
}

// ── [2] Full binary scan for old IDs ─────────────────────────────────────────
console.log(`\n[2] Full binary scan for stale IDs (63Cg, 2zrc):`);
for (const [pk, label] of Object.entries(KNOWN)) {
  if (!label.startsWith("OldID")) continue;
  const needle = Buffer.from(new PublicKey(pk).toBytes());
  let found = false;
  for (let i = 0; i <= elf.length - 32; i++) {
    let match = true;
    for (let j = 0; j < 32; j++) {
      if (elf[i + j] !== needle[j]) { match = false; break; }
    }
    if (match) {
      found = true;
      const inText   = text   && i >= text.offset   && i < text.offset   + text.size;
      const inRodata = rodata && i >= rodata.offset  && i < rodata.offset + rodata.size;
      const section  = inText ? ".text" : inRodata ? ".rodata" : "other";
      console.log(`  ${label} (${pk.slice(0,8)}) found at fileOff=${i}  section=${section}`);
    }
  }
  if (!found) console.log(`  ${label}: NOT FOUND in binary`);
}

// ── [3] SBF disassembler ──────────────────────────────────────────────────────
function disasmAt(elf, textSection, textOffset, numInstr) {
  const lines = [];
  let i = 0;
  let instrCount = 0;
  while (i < numInstr * 8) {
    const off = textOffset + i;
    if (off + 8 > textSection.offset + textSection.size) break;
    const bytes = elf.slice(textSection.offset + off, textSection.offset + off + 8);
    const hex   = bytes.toString("hex");
    const opc   = bytes[0];
    const dst   = bytes[1] & 0x0f;
    const src   = (bytes[1] >> 4) & 0x0f;
    const off16 = bytes.readInt16LE(2);
    const imm32 = bytes.readInt32LE(4);
    const imm32u = bytes.readUInt32LE(4);

    let desc = "";
    let skip = false;

    if (opc === 0x18) {
      // lddw uses two words
      const bytes2  = elf.slice(textSection.offset + off + 8, textSection.offset + off + 16);
      const imm_hi  = bytes2.readUInt32LE(4);
      const fullImm = BigInt(imm32u) | (BigInt(imm_hi) << 32n);
      desc = `lddw r${dst}, 0x${fullImm.toString(16)}`;
      // Check if this is a .rodata address
      if (rodata) {
        const rodataEnd = rodata.vma + rodata.size;
        if (fullImm >= BigInt(rodata.vma) && fullImm < BigInt(rodataEnd)) {
          const rodataRelOff = Number(fullImm - BigInt(rodata.vma));
          desc += `  ← .rodata+${rodataRelOff}`;
          // Show the 32 bytes there
          const hit32 = elf.slice(rodata.offset + rodataRelOff, rodata.offset + rodataRelOff + 32);
          let pk = "?";
          try { pk = new PublicKey(hit32).toBase58(); } catch {}
          desc += ` → ${pk.slice(0, 16)}...`;
        }
      }
      lines.push(`  +0x${off.toString(16).padStart(5,'0')}: ${hex} ${bytes2.toString("hex")}  ${desc}`);
      i += 16;
      instrCount++;
      continue;
    } else if (opc === 0x85) {
      // call — compute absolute target PC
      const thisPc = off / 8;
      const targetPc = thisPc + 1 + imm32;
      const targetOff = targetPc * 8;
      desc = `call imm=0x${imm32u.toString(16)}  → .text+0x${targetOff.toString(16)}`;
    } else if (opc === 0x95) {
      desc = `exit`;
    } else if (opc === 0xbf) {
      desc = `mov64 r${dst}, r${src}`;
    } else if (opc === 0x79) {
      desc = `ldxdw r${dst}, [r${src}${off16>=0?'+':''}${off16}]`;
    } else if (opc === 0x69) {
      desc = `ldxh r${dst}, [r${src}${off16>=0?'+':''}${off16}]`;
    } else if (opc === 0x71) {
      desc = `ldxb r${dst}, [r${src}${off16>=0?'+':''}${off16}]`;
    } else if (opc === 0x61) {
      desc = `ldxw r${dst}, [r${src}${off16>=0?'+':''}${off16}]`;
    } else if (opc === 0x55) {
      desc = `jne r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`;
    } else if (opc === 0x5d) {
      desc = `jne_x r${dst}, r${src}, off=${off16}`;
    } else if (opc === 0x15) {
      desc = `jeq r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`;
    } else if (opc === 0x1d) {
      desc = `jeq_x r${dst}, r${src}, off=${off16}`;
    } else if (opc === 0x25) {
      desc = `jgt r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`;
    } else if (opc === 0x45) {
      desc = `jset r${dst}, imm=0x${imm32u.toString(16)}, off=${off16}`;
    } else if (opc === 0x07) {
      desc = `add64 r${dst}, imm=${imm32}`;
    } else if (opc === 0x0f) {
      desc = `add64_x r${dst}, r${src}`;
    } else if (opc === 0x57) {
      desc = `and64 r${dst}, imm=0x${imm32u.toString(16)}`;
    } else if (opc === 0x67) {
      desc = `lsh64 r${dst}, imm=${imm32u}`;
    } else if (opc === 0x77) {
      desc = `rsh64 r${dst}, imm=${imm32u}`;
    } else if (opc === 0xb7) {
      desc = `mov r${dst}, imm=0x${imm32u.toString(16)}`;
    } else if (opc === 0x7b) {
      desc = `stxdw [r${dst}${off16>=0?'+':''}${off16}], r${src}`;
    } else if (opc === 0x63) {
      desc = `stxw [r${dst}${off16>=0?'+':''}${off16}], r${src}`;
    } else if (opc === 0x73) {
      desc = `stxb [r${dst}${off16>=0?'+':''}${off16}], r${src}`;
    } else {
      desc = `? opc=0x${opc.toString(16).padStart(2,'0')} dst=${dst} src=${src} off=${off16} imm=0x${imm32u.toString(16)}`;
    }

    lines.push(`  +0x${off.toString(16).padStart(5,'0')}: ${hex}  ${desc}`);
    i += 8;
    instrCount++;
  }
  return lines;
}

// Entry point
console.log(`\n[3a] Entry point (first 30 instr at .text+0):`);
disasmAt(elf, text, 0, 30).forEach(l => console.log(l));

// Function called by entry (call imm=0x5a49 at +0xa0 → target +0x2d2f0)
console.log(`\n[3b] Called function at .text+0x2d2f0 (first 60 instr):`);
disasmAt(elf, text, 0x2d2f0, 60).forEach(l => console.log(l));

// ── [4] Search all lddw instructions in the first 1000 bytes of .text ─────────
console.log(`\n[4] All lddw instructions in .text[0..0x1000] that load a .rodata address:`);
for (let i = 0; i < Math.min(0x1000, text.size - 16); i += 8) {
  const opc = elf[text.offset + i];
  if (opc !== 0x18) continue;
  const dst    = elf[text.offset + i + 1] & 0x0f;
  const imm_lo = elf.readUInt32LE(text.offset + i + 4);
  const imm_hi = elf.readUInt32LE(text.offset + i + 12);
  const full   = BigInt(imm_lo) | (BigInt(imm_hi) << 32n);
  if (rodata && full >= BigInt(rodata.vma) && full < BigInt(rodata.vma + rodata.size)) {
    const rodataOff = Number(full - BigInt(rodata.vma));
    const hit32 = elf.slice(rodata.offset + rodataOff, rodata.offset + rodataOff + 32);
    let pk = "(invalid)";
    try { pk = new PublicKey(hit32).toBase58(); } catch {}
    console.log(`  .text+0x${i.toString(16).padStart(5,'0')}  lddw r${dst}, 0x${full.toString(16)}  → .rodata+${rodataOff}  bytes=${pk}`);
  }
}

// ── [5] All lddw in the called function .text[0x2d2f0..0x2d2f0+0x400] ─────────
console.log(`\n[5] All lddw instructions in .text[0x2d2f0..0x2d2f0+0x400] that load a .rodata address:`);
for (let i = 0x2d2f0; i < Math.min(0x2d6f0, text.size - 16); i += 8) {
  const opc = elf[text.offset + i];
  if (opc !== 0x18) continue;
  const dst    = elf[text.offset + i + 1] & 0x0f;
  const imm_lo = elf.readUInt32LE(text.offset + i + 4);
  const imm_hi = elf.readUInt32LE(text.offset + i + 12);
  const full   = BigInt(imm_lo) | (BigInt(imm_hi) << 32n);
  if (rodata && full >= BigInt(rodata.vma) && full < BigInt(rodata.vma + rodata.size)) {
    const rodataOff = Number(full - BigInt(rodata.vma));
    const hit32 = elf.slice(rodata.offset + rodataOff, rodata.offset + rodataOff + 32);
    let pk = "(invalid)";
    try { pk = new PublicKey(hit32).toBase58(); } catch {}
    console.log(`  .text+0x${i.toString(16).padStart(5,'0')}  lddw r${dst}, 0x${full.toString(16)}  → .rodata+${rodataOff}  bytes=${pk}`);
  }
}
