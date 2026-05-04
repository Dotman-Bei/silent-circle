import { Connection, PublicKey } from "@solana/web3.js";
import { ARCIUM_ADDR, getMXEAccAddress, getClusterAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress, getLookupTableAddress } from "@arcium-hq/client";

const OUR_PROG    = new PublicKey("2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk");
const ARCIUM_PROG = new PublicKey(ARCIUM_ADDR);
const MXE         = getMXEAccAddress(OUR_PROG);

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const mxeInfo = await conn.getAccountInfo(MXE);
const d = mxeInfo.data;

// Parse full MXEAccount Borsh layout
let pos = 8;

// cluster: Option<u32>
const hasCluster = d[pos] === 1; pos++;
const clusterOffset = hasCluster ? d.readUInt32LE(pos) : null;
if (hasCluster) pos += 4;

// keygen_offset: u64
const keygenOffset = d.readBigUInt64LE(pos); pos += 8;

// key_recovery_init_offset: u64
const keyRecoveryInitOffset = d.readBigUInt64LE(pos); pos += 8;

// mxe_program_id: Pubkey
const mxeProgramId = new PublicKey(d.slice(pos, pos + 32)); pos += 32;

// authority: Option<Pubkey>
const hasAuthority = d[pos] === 1; pos++;
let authority = null;
if (hasAuthority) { authority = new PublicKey(d.slice(pos, pos + 32)); pos += 32; }

// utility_pubkeys: SetUnset tag (0=Unset, 1=Set)
const isSet = d[pos] === 1; pos++;
let x25519 = null;
if (isSet) {
  x25519 = d.slice(pos, pos + 32);
  pos += 32 + 32 + 32 + 64; // x25519 + ed25519 + elgamal_key + elgamal_proof
}

// lut_offset_slot: u64
const lutOffsetSlot = d.readBigUInt64LE(pos); pos += 8;

console.log("=== MXE Account State ===");
console.log("cluster:", hasCluster ? clusterOffset : "None");
console.log("keygen_offset:", keygenOffset.toString());
console.log("key_recovery_init_offset:", keyRecoveryInitOffset.toString());
console.log("authority:", authority?.toBase58() ?? "None");
console.log("x25519:", x25519 ? Buffer.from(x25519).toString("hex") : "NOT SET");
console.log("lut_offset_slot:", lutOffsetSlot.toString());

const lutAddr = getLookupTableAddress(OUR_PROG, lutOffsetSlot);
console.log("LUT address:", lutAddr.toBase58());

console.log("\n=== Computation Accounts ===");
for (const clOff of [clusterOffset, 456, 69420].filter((x, i, a) => x != null && a.indexOf(x) === i)) {
  const clBuf = Buffer.alloc(4); clBuf.writeUInt32LE(clOff);
  const kgBuf = Buffer.alloc(8); kgBuf.writeBigUInt64LE(keygenOffset);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ComputationAccount"), clBuf, kgBuf],
    ARCIUM_PROG
  );
  const info = await conn.getAccountInfo(pda);
  console.log(`cluster ${clOff}: ${pda.toBase58()} — ${info ? `EXISTS (${info.data.length}b)` : "NOT FOUND"}`);
}

console.log("\nCluster 456 accounts:");
console.log("  cluster:", getClusterAccAddress(456, ARCIUM_PROG).toBase58());
console.log("  mempool:", getMempoolAccAddress(456, ARCIUM_PROG).toBase58());
console.log("  execpool:", getExecutingPoolAccAddress(456, ARCIUM_PROG).toBase58());
