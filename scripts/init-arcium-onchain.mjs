/**
 * One-time on-chain setup for the SilentCircle Arcium integration.
 *
 * Steps:
 *   1. set-cluster     — move the MXE from cluster 69420 to cluster 456.
 *   2. requeue-keygen  — re-submit the MXE keygen to cluster 456's mempool.
 *                        Wait ~2 minutes for executors to complete keygen.
 *   3. init-comp-def   — register the "compute_psi" comp def with the MXE.
 *                        Run once x25519 key is set.
 *
 * Usage:
 *   node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step set-cluster
 *   node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step requeue-keygen
 *   node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step init-comp-def
 *   node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step check
 *
 * Requires @solana/web3.js and @coral-xyz/anchor in node_modules.
 */

import { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { AnchorProvider, Program, setProvider, BorshCoder } from "@coral-xyz/anchor";
import { ARCIUM_IDL, ARCIUM_ADDR, getMXEAccAddress, getClusterAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress } from "@arcium-hq/client";
import fs from "node:fs";
import path from "node:path";

const OUR_PROGRAM_ID     = new PublicKey("EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq");
const ARCIUM_PROGRAM_ID  = new PublicKey(ARCIUM_ADDR);
const CLUSTER_OFFSET_456 = 456;

// Pre-derived PDAs for cluster 456
const MXE_PUBKEY      = getMXEAccAddress(OUR_PROGRAM_ID);
const CLUSTER_456     = getClusterAccAddress(CLUSTER_OFFSET_456, ARCIUM_PROGRAM_ID);
const MEMPOOL_456     = getMempoolAccAddress(CLUSTER_OFFSET_456, ARCIUM_PROGRAM_ID);
const EXECPOOL_456    = getExecutingPoolAccAddress(CLUSTER_OFFSET_456, ARCIUM_PROGRAM_ID);

// comp_def_offset("compute_psi") — first 4 bytes of SHA-256 as LE u32
const COMP_DEF_OFFSET = 2776726673;
const COMP_DEF_PUBKEY = new PublicKey("CGneqtmCiys7sxPD9Y2beWceoF8SdkMwQAah1xo99CaW");

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { opts[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return opts;
};

/** Parse MXEAccount Borsh to extract keygen_offset. */
const parseMxeKeygenOffset = (data) => {
  let pos = 8; // skip discriminator
  const hasCluster = data[pos] === 1; pos += 1;
  if (hasCluster) pos += 4;              // Option<u32>
  const lo = data.readBigUInt64LE(pos);  // keygen_offset u64
  return lo;
};

/** Parse MXEAccount Borsh to extract x25519 pubkey (null if keygen not done). */
const parseMxeX25519 = (data) => {
  let pos = 8;
  const hasCluster = data[pos] === 1; pos += 1;
  if (hasCluster) pos += 4;
  pos += 8; // keygen_offset
  pos += 8; // key_recovery_init_offset
  pos += 32; // mxe_program_id
  const hasAuth = data[pos] === 1; pos += 1;
  if (hasAuth) pos += 32;
  const isSet = data[pos] === 1; pos += 1;
  if (!isSet) return null;
  const x25519 = data.slice(pos, pos + 32);
  return x25519.every(b => b === 0) ? null : x25519;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.keypair) {
    console.error("Usage: node scripts/init-arcium-onchain.mjs --keypair <path> --step <requeue-keygen|init-comp-def|check>");
    process.exit(1);
  }

  const keypairPath = opts.keypair.replace(/^~/, process.env.USERPROFILE || process.env.HOME);
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  const step = opts.step || "check";

  // ── check ──────────────────────────────────────────────────────────────────
  if (step === "check") {
    console.log("\n=== Arcium MXE Status ===");
    console.log("MXE pubkey:", MXE_PUBKEY.toBase58());
    const mxeInfo = await connection.getAccountInfo(MXE_PUBKEY);
    if (!mxeInfo) { console.log("MXE account NOT FOUND on-chain"); return; }
    const x25519 = parseMxeX25519(mxeInfo.data);
    const keygenOffset = parseMxeKeygenOffset(mxeInfo.data);
    console.log("keygen_offset:", keygenOffset.toString());
    if (x25519) {
      console.log("✓ x25519 key SET:", Buffer.from(x25519).toString("hex"));
      console.log("→ Ready to call init-comp-def");
    } else {
      console.log("✗ x25519 key NOT SET (keygen pending)");
      console.log("→ Waiting for cluster 456 executors to process keygen. Re-run --step check in 2 min.");
    }
    console.log("\nCluster 456:", CLUSTER_456.toBase58());
    console.log("Mempool 456:", MEMPOOL_456.toBase58());
    console.log("ExecPool 456:", EXECPOOL_456.toBase58());

    const compDefInfo = await connection.getAccountInfo(COMP_DEF_PUBKEY);
    console.log("\nCompDef account:", COMP_DEF_PUBKEY.toBase58());
    console.log(compDefInfo ? "✓ CompDef EXISTS" : "✗ CompDef NOT initialized → run init-comp-def");
    return;
  }

  // ── set-cluster ────────────────────────────────────────────────────────────
  if (step === "set-cluster") {
    if (balance < 0.01e9) {
      console.error("⚠️  Need ≥0.01 SOL. Fund wallet:", wallet.publicKey.toBase58());
      process.exit(1);
    }

    console.log(`\nCalling set_cluster(456) on the Arcium program...`);
    console.log("MXE:", MXE_PUBKEY.toBase58());
    console.log("Cluster 456:", CLUSTER_456.toBase58());

    // set_cluster discriminator: [140, 96, 38, 83, 225, 128, 25, 176]
    const discriminator = Buffer.from([140, 96, 38, 83, 225, 128, 25, 176]);
    const args = Buffer.alloc(4); args.writeUInt32LE(CLUSTER_OFFSET_456);
    const data = Buffer.concat([discriminator, args]);

    const CLOCK_PUBKEY = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");

    const ix = new TransactionInstruction({
      programId: ARCIUM_PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true,  isWritable: true  }, // signer
        { pubkey: MXE_PUBKEY,       isSigner: false, isWritable: false }, // mxe
        { pubkey: CLUSTER_456,      isSigner: false, isWritable: true  }, // cluster
        { pubkey: OUR_PROGRAM_ID,   isSigner: false, isWritable: false }, // mxe_program
        { pubkey: CLOCK_PUBKEY,     isSigner: false, isWritable: true  }, // clock
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log("✓ set_cluster(456) succeeded:", sig);
      console.log("→ Now run --step requeue-keygen");
    } catch (e) {
      console.error("Error:", e.message);
      if (e.logs) console.error("Logs:\n" + e.logs.join("\n"));
    }
    return;
  }

  // ── requeue-keygen ─────────────────────────────────────────────────────────
  if (step === "requeue-keygen") {
    if (balance < 0.01e9) {
      console.error("⚠️  Need ≥0.01 SOL. Fund wallet:", wallet.publicKey.toBase58());
      process.exit(1);
    }

    console.log(`\nRequeuing MXE keygen to cluster 456...`);
    console.log("MXE:", MXE_PUBKEY.toBase58());
    console.log("Cluster:", CLUSTER_456.toBase58());
    console.log("Mempool:", MEMPOOL_456.toBase58());
    console.log("ExecPool:", EXECPOOL_456.toBase58());

    // Read MXE to get keygen_offset for the computation PDA
    const mxeInfo = await connection.getAccountInfo(MXE_PUBKEY);
    if (!mxeInfo) throw new Error("MXE account not found on devnet");
    const keygenOffset = parseMxeKeygenOffset(mxeInfo.data);
    console.log("keygen_offset:", keygenOffset.toString());

    // Derive mxe_keygen_computation PDA: [ComputationAccount, cluster_u32, keygen_u64]
    const clusterBuf = Buffer.alloc(4); clusterBuf.writeUInt32LE(CLUSTER_OFFSET_456);
    const keygenBuf  = Buffer.alloc(8); keygenBuf.writeBigUInt64LE(keygenOffset);
    const [mxeKeygenComp] = PublicKey.findProgramAddressSync(
      [Buffer.from("ComputationAccount"), clusterBuf, keygenBuf],
      ARCIUM_PROGRAM_ID
    );
    console.log("mxe_keygen_computation:", mxeKeygenComp.toBase58());

    // Build instruction using Arcium IDL discriminator
    const discriminator = Buffer.from([90, 98, 117, 181, 88, 71, 135, 30]);
    const args = Buffer.alloc(4); args.writeUInt32LE(CLUSTER_OFFSET_456);
    const data = Buffer.concat([discriminator, args]);

    const ix = new TransactionInstruction({
      programId: ARCIUM_PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true,  isWritable: true  }, // signer
        { pubkey: MXE_PUBKEY,       isSigner: false, isWritable: false }, // mxe
        { pubkey: EXECPOOL_456,     isSigner: false, isWritable: true  }, // executing_pool
        { pubkey: MEMPOOL_456,      isSigner: false, isWritable: true  }, // mempool
        { pubkey: CLUSTER_456,      isSigner: false, isWritable: false }, // cluster
        { pubkey: mxeKeygenComp,    isSigner: false, isWritable: true  }, // mxe_keygen_computation
        { pubkey: OUR_PROGRAM_ID,   isSigner: false, isWritable: false }, // mxe_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log("✓ requeue_mxe_keygen succeeded:", sig);
      console.log("Wait ~2 minutes, then run --step check to see if x25519 is set.");
    } catch (e) {
      console.error("Error:", e.message);
      if (e.logs) console.error("Logs:\n" + e.logs.join("\n"));
    }
    return;
  }

  // ── init-comp-def ──────────────────────────────────────────────────────────
  if (step === "init-comp-def") {
    if (balance < 0.05e9) {
      console.error("⚠️  Need ≥0.05 SOL for comp def rent. Fund wallet:", wallet.publicKey.toBase58());
      process.exit(1);
    }

    // Check x25519 is set first
    const mxeInfo = await connection.getAccountInfo(MXE_PUBKEY);
    if (!mxeInfo) throw new Error("MXE account not found");
    const x25519 = parseMxeX25519(mxeInfo.data);
    if (!x25519) {
      console.error("⚠️  MXE x25519 key not set yet — run requeue-keygen first and wait for keygen to complete.");
      process.exit(1);
    }
    console.log("✓ x25519 key confirmed:", Buffer.from(x25519).toString("hex"));

    const idlPath = path.join(process.cwd(), "target", "idl", "silent_circle.json");
    if (!fs.existsSync(idlPath)) {
      console.error("IDL not found at", idlPath, "\nRun: anchor build");
      process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

    const provider = new AnchorProvider(connection, {
      publicKey: wallet.publicKey,
      signTransaction:     async (tx) => { tx.partialSign(wallet); return tx; },
      signAllTransactions: async (txs) => txs.map(tx => { tx.partialSign(wallet); return tx; }),
    }, { commitment: "confirmed" });
    setProvider(provider);

    const program = new Program(idl, provider);

    // Derive address_lookup_table PDA from mxe.lut_offset_slot
    const lutOffsetSlot = (() => {
      // lut_offset_slot is at a fixed offset in MXEAccount — read from account data
      // Layout after x25519+ed25519+elgamal+proof: complex, use SDK helper
      // For now use the on-chain account directly via Anchor decode
      return null;
    })();

    try {
      const tx = await program.methods
        .initComputePsiCompDef()
        .accounts({
          payer:           wallet.publicKey,
          mxeAccount:      MXE_PUBKEY,
          compDefAccount:  COMP_DEF_PUBKEY,
          arciumProgram:   ARCIUM_PROGRAM_ID,
          systemProgram:   SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();
      console.log("✓ init_compute_psi_comp_def succeeded:", tx);
      console.log("→ SilentCircle is fully operational on devnet!");
    } catch (e) {
      console.error("Error:", e.message);
      if (e.logs) console.error("Logs:\n" + e.logs.join("\n"));
    }
    return;
  }

  console.error("Unknown step:", step, "— use requeue-keygen, init-comp-def, or check");
  process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
