# SilentCircle

> Two Solana wallets discover what tokens, NFT collections, and DAO memberships
> they share — without either side revealing its full portfolio, and without a
> server in the middle.

SilentCircle is a private mutual wallet-discovery app for Solana. The Anchor
program runs the session lifecycle, the Vite frontend prepares encrypted
inputs, and Arcium's MXE network runs the Private Set Intersection (PSI) over
both wallets' encrypted asset sets. Only the intersection comes back on-chain
— neither wallet, nor any single Arcium node, ever sees the other's full list.

## What SilentCircle Solves

OTC traders, DAO coalition builders, and token-gated communities all need to
prove on-chain common ground (a shared SPL token, a shared NFT collection, a
shared DAO seat) before they coordinate further. The two existing options are
both bad:

- **Reveal everything to the counterparty.** Hand over a full portfolio and
  trust them not to screenshot, mass-mail, or front-run it.
- **Reveal everything to a server.** Send both portfolios to a "private match"
  service and trust the operator. That's just centralised custody of metadata.

SilentCircle does neither. Each wallet hashes and encrypts its asset set
client-side under the MXE cluster's X25519 key, commits a short hash to a
Solana PDA, and Arcium computes the intersection inside a garbled circuit.
The session PDA receives only the matched fingerprints back via a signed
callback.

## Why Arcium Is Necessary

Without MPC, *somebody* always sees the full inputs — either the counterparty
or a centralised matching server. Arcium's MXE network is the missing primitive:

- The PSI circuit ([arcium_compute/src/psi.rs](arcium_compute/src/psi.rs))
  runs inside a garbled circuit. No single Arcium node — and not Arcium as an
  operator — ever sees plaintext inputs from either wallet.
- The MXE returns a signature over the result. The Anchor callback
  ([programs/silent_circle/src/instructions/write_intersection.rs](programs/silent_circle/src/instructions/write_intersection.rs))
  verifies that signature against the Arcium cluster account before writing the
  intersection — so even the program will reject a forged result.
- Removing Arcium collapses the privacy guarantee. The frontend, hashes, and
  on-chain commitments are all still there, but the actual matching has to
  happen *somewhere*, and any "somewhere" without MPC is a leak.

## Architecture

```
 ┌─────────────────────┐    ┌──────────────────────────┐    ┌─────────────────────┐
 │  Frontend (Vite)    │    │  Solana program (Anchor) │    │  Arcium MXE network │
 │                     │    │                          │    │                     │
 │  • wallet connect   │    │  Session PDA             │    │  PSI garbled circuit│
 │  • fetch SPL/NFT/   │    │   ├─ wallet_a / wallet_b │    │   ├─ ingests Enc<>  │
 │    DAO              │    │   ├─ commitment_a/b      │    │   ├─ 4×4 compare    │
 │  • encrypt set      │──▶ │   ├─ asset_mask, expiry  │ ◀▶ │   ├─ reveals inter- │
 │    (X25519 + AES-   │    │   └─ intersection: Vec   │    │   │  section only   │
 │    256-GCM)         │    │                          │    │   └─ signs output   │
 │  • commit hash      │    │  Instructions            │    │                     │
 │  • render matches   │    │   create_session         │    │                     │
 │                     │    │   commit_set             │    │                     │
 │                     │    │   start_psi  ───CPI────▶ │    │                     │
 │                     │    │   write_intersection ◀── │ ◀──┤  signed callback    │
 │                     │    │   close_session (rent)   │    │                     │
 └─────────────────────┘    └──────────────────────────┘    └─────────────────────┘
```

**Data flow for one session:**

1. Wallet A picks an asset mask (tokens / NFT collections / DAOs), the
   frontend hashes each mint to a 32-byte fingerprint, derives a session PDA
   under `["session", session_id]`, and calls `create_session` with the
   commitment.
2. Wallet A copies the invite link `?/session/<base58_session_id>`.
3. Wallet B opens the link, picks its own mask, encrypts its set under the
   MXE cluster X25519 key, and calls `commit_set`.
4. Either wallet calls `start_psi`, which queues a computation on Arcium's
   mempool with both encrypted sets as `Enc<Shared>` arguments and registers
   `write_intersection` as the success callback.
5. The MXE runs `compute_psi` — a 4×4 fixed-circuit comparison over the two
   encrypted sets — and returns `[u64; 4]` (up to four matched fingerprints,
   zero-padded). The result is signed by the cluster.
6. The Arcium program CPIs back into `write_intersection`. The Anchor program
   verifies the cluster signature, expands each non-zero fingerprint into a
   `[u8; 32]`, stores them on the session PDA, and emits `IntersectionReady`.
7. The frontend (polling the PDA every 3 s) sees the new state, resolves each
   fingerprint back to a human-readable name (Jupiter token list, Metaplex
   metadata, SPL Governance realm), and renders the match cards.

More detail and account-layout notes live in
[docs/architecture.md](docs/architecture.md).

## Repo Layout

```text
.
├── src/                                   # Vite + React frontend
│   ├── lib/                               # asset fetching, encryption, on-chain client
│   ├── hooks/use-arcium-cluster.ts        # MXE cluster X25519 key fetch
│   └── pages/Index.tsx                    # session console (3 screens in one)
├── programs/silent_circle/src/            # Anchor program (Rust)
│   ├── lib.rs                             # state, IDs, comp_def setup
│   └── instructions/                      # create / commit / start / callback / close
├── arcium_compute/src/psi.rs              # MXE compute_psi circuit
├── tests/silent_circle.ts                 # Anchor mocha integration tests
├── scripts/                               # devnet bootstrap + deploy wrappers
├── docs/architecture.md                   # diagrams + data-flow notes
├── Anchor.toml
├── Cargo.toml
└── .env.example
```

## How to Run Locally

### 1. Frontend only (no on-chain calls)

```bash
npm install
cp .env.example .env       # default RPC + program ID are already devnet-friendly
npm run dev
```

Useful subcommands:

```bash
npm run test               # vitest unit tests for the frontend
npm run build              # production bundle
```

### 2. Full on-chain stack (Anchor + Arcium devnet)

Prerequisites — Solana CLI 1.18+, Anchor 0.32+, Arcium CLI. On Windows install
inside WSL2; the bootstrap script handles it:

```bash
npm run setup:wsl:dry-run  # preview
npm run setup:wsl          # actually install (elevated PowerShell)
bash /mnt/c/Users/bamig/Documents/VIBE\ CODE/SILENT\ CIRCLE/scripts/bootstrap-devnet-toolchain.sh
```

Then deploy:

```bash
solana airdrop 2                           # fund the deploy keypair
npm run deploy:devnet:dry-run              # preview the deploy wrapper
npm run deploy:devnet                      # anchor build + keys sync + deploy
```

The deploy wrapper updates `.env.local` with the deployed program ID. To wire
in Arcium IDs after `arcium register-mxe` and `arcium register-computation`:

```bash
node scripts/configure-devnet-env.mjs \
  --program-id <deployed devnet program id> \
  --psi-computation-pubkey <computation pubkey> \
  --mxe-pubkey <mxe pubkey>
```

Restart the frontend with `npm run dev` and the Solana session-creation,
counterparty-join, and PSI-start flows now target the live program.

### 3. Anchor integration tests

After `anchor build` generates the IDL:

```bash
anchor test --provider.cluster devnet      # or `localnet` against a local validator
```

The suite covers `create_session`, `commit_set` (happy path + double-join +
expired-session rejection), `write_intersection` (rejects non-Arcium callers),
and `close_session` (requires expiry + initiator authority + rent refund).

## Environment Variables

`.env.example` is the reference. Only `VITE_*` vars reach the browser.

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_SOLANA_RPC_URL` | frontend | Solana RPC endpoint (default: devnet) |
| `VITE_SILENT_CIRCLE_PROGRAM_ID` | frontend | Switches the join flow from local-only to on-chain |
| `VITE_ARCIUM_*` | frontend | MXE / mempool / cluster / comp-def addresses |
| `VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX` | frontend | Optional 64-char hex of the cluster's X25519 key — skips an RPC call on every `start_psi` |
| `ANCHOR_PROGRAM_ID` | scripts | Mirrored devnet program ID for Anchor tooling |
| `PSI_COMPUTATION_PUBKEY` / `ARCIUM_MXE_PUBKEY` | scripts | Arcium IDs consumed by `configure-devnet-env.mjs` |

## Status

Implemented:

- Vite frontend with wallet connect, asset selection, live SPL token / NFT
  collection / DAO membership fetching, deterministic commitment preview,
  session PDA polling, and intersection match resolution.
- Anchor program with `create_session`, `commit_set`, `start_psi`,
  `write_intersection` (Arcium callback), and `close_session` (rent reclaim).
- Client-side X25519 + HKDF + AES-256-GCM encryption of asset fingerprints.
- Arcium `compute_psi` garbled-circuit definition (4-element fixed PSI).
- Mocha integration tests covering all five instructions.
- WSL bootstrap + devnet deploy + env-wiring scripts.
- Dialect deep-link from the Match Result for post-match coordination.

Out of scope for the RTG submission (extension ideas):

- Multi-round PSI with refined masks.
- ZK proof-of-membership tokens for matched assets.
- Full SPL Governance "shared seat" attestations.
