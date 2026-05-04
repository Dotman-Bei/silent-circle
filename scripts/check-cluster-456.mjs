import { Connection, PublicKey } from "@solana/web3.js";
import { ARCIUM_ADDR, getMXEAccAddress, getMempoolAccAddress,
         getExecutingPoolAccAddress, getClusterAccAddress } from "@arcium-hq/client";

const NEW_PROG    = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const ARCIUM_PROG = new PublicKey(ARCIUM_ADDR);
const MXE         = getMXEAccAddress(NEW_PROG);
const MEMPOOL     = getMempoolAccAddress(456, ARCIUM_PROG);
const EXECPOOL    = getExecutingPoolAccAddress(456, ARCIUM_PROG);
const CLUSTER     = getClusterAccAddress(456, ARCIUM_PROG);

const conn = new Connection("https://api.devnet.solana.com", "confirmed");

// Parse MXE to check keygen state
const mxeInfo = await conn.getAccountInfo(MXE);
const d = mxeInfo.data;
let pos = 8;
const hasCluster = d[pos] === 1; pos++;
if (hasCluster) { const cl = d.readUInt32LE(pos); pos += 4; console.log("MXE cluster field:", cl); }
const keygenOffset = d.readBigUInt64LE(pos); pos += 8;
console.log("keygen_offset:", keygenOffset.toString());

// Compute keygen computation PDA
const clBuf = Buffer.alloc(4); clBuf.writeUInt32LE(456);
const kgBuf = Buffer.alloc(8); kgBuf.writeBigUInt64LE(keygenOffset);
const [keygenCompPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("ComputationAccount"), clBuf, kgBuf], ARCIUM_PROG
);
const compInfo = await conn.getAccountInfo(keygenCompPda);
console.log("\nKeygen computation PDA:", keygenCompPda.toBase58());
console.log("Exists:", compInfo ? `YES (${compInfo.data.length} bytes)` : "NO — keygen not queued!");

// Check mempool
const mempoolInfo = await conn.getAccountInfo(MEMPOOL);
if (mempoolInfo) {
  const compCount = mempoolInfo.data.readBigUInt64LE(41);
  console.log("\nMempool computation_count (next slot):", compCount.toString());
} else {
  console.log("\nMempool: NOT FOUND");
}

// Check execpool for active ARX nodes
const execpoolInfo = await conn.getAccountInfo(EXECPOOL);
console.log("\nExecPool:", EXECPOOL.toBase58());
if (execpoolInfo) {
  console.log("ExecPool exists:", execpoolInfo.data.length, "bytes");
  // Try to count active nodes — execpool stores a list of node registrations
  // Simple heuristic: non-zero bytes after header suggest active nodes
  const nonZero = execpoolInfo.data.slice(8).some(b => b !== 0);
  console.log("ExecPool has non-zero data:", nonZero ? "YES (nodes may be active)" : "NO (empty/inactive)");
} else {
  console.log("ExecPool: NOT FOUND");
}

// Check cluster account
const clusterInfo = await conn.getAccountInfo(CLUSTER);
console.log("\nCluster 456:", CLUSTER.toBase58());
console.log("Cluster exists:", clusterInfo ? `YES (${clusterInfo.data.length} bytes)` : "NO");

// Check recent txs on execpool to see if any nodes responded
const sigs = await conn.getSignaturesForAddress(EXECPOOL, { limit: 10 });
console.log("\nRecent execpool transactions:", sigs.length);
sigs.forEach(s => {
  const age = Math.round((Date.now() - (s.blockTime ?? 0) * 1000) / 60000);
  console.log(" ", age, "min ago —", s.signature.slice(0, 20) + "...", s.err ? "(FAILED)" : "(ok)");
});
