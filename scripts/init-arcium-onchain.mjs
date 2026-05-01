/**
 * One-time on-chain setup for the SilentCircle Arcium integration.
 *
 * Calls two instructions on the deployed program:
 *   1. requeue_mxe_keygen  — re-submits the stuck MXE keygen computation to
 *                            cluster 69420.  Run this first; wait ~2 minutes
 *                            before step 2.
 *   2. init_compute_psi_comp_def — registers the "compute_psi" computation
 *                            definition with the MXE.  Run once keygen is done.
 *
 * Usage:
 *   node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step requeue-keygen
 *   node scripts/init-arcium-onchain.mjs --keypair ~/.config/solana/id.json --step init-comp-def
 *
 * Requires @solana/web3.js and @coral-xyz/anchor in node_modules.
 */

import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { AnchorProvider, Program, setProvider } from "@coral-xyz/anchor";
import fs from "node:fs";
import path from "node:path";

const PROGRAM_ID = new PublicKey("2zrcqoTBEvu35EN4sv64vXTqqynNM4m8Q7xK5cdzJvKk");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const MXE_PUBKEY = new PublicKey("257wp1NSQ6jfDbyMfS4nsNWHmGFyWky6a1gwW4FLmvjr");
const CLUSTER_PUBKEY = new PublicKey("FYRnYXA1Zr8fVdVo48QQDLuXXDb8FJpjath3hDxtxvZV");
const MEMPOOL_PUBKEY = new PublicKey("CFvzhgKmse4s6rqci3GnzxRdgj1H33B5vjg17RXjmFkk");
const EXECPOOL_PUBKEY = new PublicKey("6jgGbQWjWyDFBSWA19FtgrM9LH4gQD54JFk3RwaYpU49");

// comp_def_offset("compute_psi") = SHA-256("compute_psi")[0..4] LE = 2776726673
const COMP_DEF_OFFSET = 2776726673;
const COMP_DEF_PUBKEY = new PublicKey("2kpz4nGokpcr9guxSo8S3a8CXKMcVzyrA6w3AUuUcU98");

const FEE_POOL_PUBKEY = new PublicKey("G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC");
const CLOCK_PUBKEY    = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      opts[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return opts;
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.keypair) {
    console.error("Usage: node scripts/init-arcium-onchain.mjs --keypair <path> --step <requeue-keygen|init-comp-def>");
    process.exit(1);
  }

  const keypairPath = opts.keypair.replace("~", process.env.HOME || process.env.USERPROFILE);
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")));
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  if (balance < 0.05e9) {
    console.error("⚠️  Insufficient balance. Fund with: solana airdrop 1 --url devnet");
    process.exit(1);
  }

  const step = opts.step || "init-comp-def";

  if (step === "requeue-keygen") {
    console.log("Requeueing MXE keygen on cluster 69420...");
    // The requeue_mxe_keygen instruction requires the Arcium program
    // Load the IDL from the deployed program or use the Arcium IDL
    const { default: client } = await import("@arcium-hq/client");

    // Build requeue_mxe_keygen instruction using the Arcium IDL
    // This is an instruction on the ARCIUM program, not our program
    console.log("TODO: Use arcium CLI: arcium requeue-mxe-keygen --cluster devnet");
    console.log("Or contact Arcium Discord for help with cluster 69420.");
    return;
  }

  if (step === "init-comp-def") {
    console.log("Initializing compute_psi computation definition...");

    // Load the silent_circle IDL
    const idlPath = path.join(process.cwd(), "target", "idl", "silent_circle.json");
    if (!fs.existsSync(idlPath)) {
      console.error("IDL not found at", idlPath);
      console.error("Run: anchor build --provider.cluster devnet");
      process.exit(1);
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

    const provider = new AnchorProvider(connection, {
      publicKey: wallet.publicKey,
      signTransaction: async (tx) => { tx.partialSign(wallet); return tx; },
      signAllTransactions: async (txs) => txs.map(tx => { tx.partialSign(wallet); return tx; }),
    }, { commitment: "confirmed" });
    setProvider(provider);

    const program = new Program(idl, provider);

    // Find address_lookup_table PDA
    const MXE_LUT_SEED = "MxeLutAccount";
    // Get the lut_offset_slot from the MXE account
    const mxeInfo = await connection.getAccountInfo(MXE_PUBKEY);
    if (!mxeInfo) throw new Error("MXE account not found");

    // For now, use the program's built-in init_compute_psi_comp_def
    // which calls init_comp_def from arcium-anchor
    try {
      const tx = await program.methods
        .initComputePsiCompDef()
        .accounts({
          payer: wallet.publicKey,
          mxeAccount: MXE_PUBKEY,
          compDefAccount: COMP_DEF_PUBKEY,
          arciumProgram: ARCIUM_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();
      console.log("✓ init_compute_psi_comp_def succeeded:", tx);
    } catch (e) {
      console.error("Error:", e.message);
      if (e.logs) console.error("Logs:", e.logs.join("\n"));
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
