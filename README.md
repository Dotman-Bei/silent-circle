# SilentCircle

> Two Solana wallets discover what tokens, NFT collections, and DAO memberships
> they share — without either side revealing its full portfolio, and without a
> server in the middle.

SilentCircle is a private mutual wallet-discovery app built on Solana and
Arcium. The Anchor program manages the session lifecycle on-chain, the Vite
frontend prepares encrypted inputs client-side, and Arcium's Multi-party
eXecution Environment (MXE) runs the Private Set Intersection (PSI) circuit
over both wallets' encrypted asset sets. Only the intersection fingerprints
come back on-chain — neither wallet, nor any individual Arcium node, ever sees
the other's full asset list.

**Deployed program:** `EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq` (Solana devnet)

---

## Innovation

SilentCircle introduces a pattern that does not exist in the current Solana
ecosystem: **on-chain, verifiable, two-party Private Set Intersection with
zero server trust**.

Most "private matching" tools on-chain today are either:
- Merkle-proof inclusion schemes that prove a single item is in a set (but
  require publishing the full set root to a server or IPFS), or
- Trust-me-server products where the operator runs the matching and promises
  not to leak inputs.

SilentCircle takes a different path:

1. **Client-side fingerprinting.** Each mint address is hashed to a 64-bit
   fingerprint via SHA-256 on the user's own machine. The fingerprint is what
   goes into the circuit, never the raw mint.

2. **X25519 + HKDF + AES-256-GCM encryption.** Each wallet encrypts its
   fingerprint set under the MXE cluster's X25519 public key before the data
   leaves the browser. The encrypted blobs are committed to a Solana PDA — not
   sent to any API.

3. **Garbled-circuit PSI inside Arcium's MXE.** The `compute_psi` circuit
   ([arcium_compute/src/psi.rs](arcium_compute/src/psi.rs)) performs a
   compile-time-fixed 4×4 comparison over the two encrypted sets entirely
   inside the MXE's trusted execution environment. The circuit outputs only
   the matched fingerprints (`[u64; 4]`, zero-padded).

4. **On-chain result verification.** The Anchor callback
   (`compute_psi_callback`) rejects any result not signed by the registered
   Arcium cluster. A forged or replayed result will fail the signature check
   before anything is written to the session PDA.

This combination — deterministic Solana state, client-side encryption, and
MPC-evaluated PSI with an on-chain verified result — is novel as a complete,
composable primitive on Solana devnet today.

---

## Impact

**OTC coordination without exposure.** Large token holders negotiating
bilateral trades need to confirm shared positions before disclosing intent.
Today that means emailing a screenshot of a portfolio — a data leak that
frequently leads to front-running. SilentCircle reduces this to "connect
wallet, share a link, see only what overlaps."

**DAO coalition building.** DAO governance increasingly involves multi-DAO
alliances. Representatives need to find shared membership (governance tokens,
realm seats) to establish trust without disclosing voter-weight data to
potential adversaries. SilentCircle provides a single-session proof of common
membership that leaves no persistent exposure.

**Token-gated community discovery.** NFT project communities want to know
which collectors share holdings with a specific counterparty for co-marketing
or joint access grants. PSI lets two parties confirm a shared collection
without broadcasting full wallet contents.

**Composable on-chain primitive.** Because the PSI result is written to a
verified Solana PDA — and because the callback rejects unverified results —
downstream programs can CPI into a SilentCircle session PDA to gate access,
trigger transfers, or issue attestations based on confirmed intersections. The
session PDA is a building block, not just a display.

**Near-zero trust surface.** Neither party needs to trust the other. Neither
needs to trust a matching service operator. The trust is reduced to the Arcium
MXE cluster and the Solana validator set — both of which are publicly auditable
and decentralised.

---

## Why Arcium Is Essential

Without MPC, *somebody* always sees the full inputs — either the counterparty
directly or a centralised matching server. Arcium's MXE is the primitive that
closes that gap:

- The PSI circuit runs inside a garbled circuit. No single Arcium node — and
  not Arcium as an operator — ever sees plaintext fingerprints from either
  wallet.
- The MXE signs its output. The `compute_psi_callback` instruction verifies
  the signature against the registered cluster account on-chain before writing
  any intersection to the session PDA. A tampered or replayed result is
  rejected at the program level.
- Removing Arcium collapses the privacy guarantee completely. The frontend,
  commitments, and on-chain state remain, but the actual set comparison must
  happen *somewhere*, and any execution environment without MPC is a
  confidentiality leak.

---

## Architecture

```
 ┌─────────────────────┐    ┌──────────────────────────┐    ┌─────────────────────┐
 │  Frontend (Vite)    │    │  Solana program (Anchor) │    │  Arcium MXE network │
 │                     │    │                          │    │                     │
 │  • wallet connect   │    │  Session PDA             │    │  compute_psi circuit│
 │  • fetch SPL/NFT/   │    │   ├─ wallet_a / wallet_b │    │   ├─ Enc<Shared>    │
 │    DAO assets       │    │   ├─ commitment_a/b      │    │   ├─ 4×4 comparison │
 │  • SHA-256 → u64    │──▶ │   ├─ asset_mask, expiry  │ ◀▶ │   ├─ reveals inter- │
 │    fingerprints     │    │   ├─ arcium_task_id      │    │   │  section only   │
 │  • X25519+AES-GCM   │    │   └─ intersection: Vec   │    │   └─ signs result   │
 │    encryption       │    │                          │    │                     │
 │  • commit on-chain  │    │  Instructions            │    │                     │
 │  • poll PDA (3 s)   │    │   create_session         │    │                     │
 │  • render matches   │    │   commit_set             │    │                     │
 │                     │    │   start_psi  ───CPI────▶ │    │                     │
 │                     │    │   compute_psi_callback ◀─│ ◀──┤  signed callback    │
 │                     │    │   close_session (rent)   │    │                     │
 └─────────────────────┘    └──────────────────────────┘    └─────────────────────┘
```

**Session data flow:**

1. **Wallet A** picks an asset mask (tokens / NFT collections / DAOs). The
   frontend hashes each mint/collection/realm address to a 64-bit fingerprint
   (first 8 bytes of SHA-256), derives a session PDA under
   `["session", session_id]`, and calls `create_session` with a 32-byte
   commitment and expiry timestamp.
2. Wallet A copies the invite URL: `/session/<base58_session_id>`.
3. **Wallet B** opens the link, picks its own mask, and calls `commit_set`.
   The session PDA transitions to `BothCommitted`.
4. Either wallet calls `start_psi`. Both wallets' fingerprints — each
   encrypted under the MXE cluster's X25519 key via HKDF + AES-256-GCM — are
   passed as `Enc<Shared>` arguments. Arcium queues a `compute_psi` task on
   the MXE mempool.
5. The MXE evaluates the 4×4 garbled-circuit comparison and returns
   `[u64; 4]` (up to four matched fingerprints, zero-padded). The result is
   signed by the cluster.
6. The Arcium program CPIs back into `compute_psi_callback`. The instruction
   verifies the cluster signature, expands each non-zero fingerprint into a
   `[u8; 32]` hash, appends them to `intersection: Vec<[u8; 32]>` on the
   session PDA (up to 50 entries), and emits `IntersectionReady`.
7. The frontend (polling the PDA every 3 s) detects the `Done` state,
   resolves each fingerprint back to a human-readable name using the Jupiter
   token list, Metaplex metadata, or SPL Governance realm data, and renders
   the match cards.

Full account-layout and byte-offset notes: [docs/architecture.md](docs/architecture.md).

---

## Repo Layout

```
.
├── src/                                   # Vite + React frontend
│   ├── lib/                               # asset fetching, encryption, on-chain client
│   ├── hooks/use-arcium-cluster.ts        # MXE cluster X25519 key fetch
│   └── pages/
│       ├── Welcome.tsx                    # landing page
│       ├── Index.tsx                      # interactive session console
│       └── HowItWorks.tsx                 # protocol walkthrough
├── programs/silent_circle/src/            # Anchor program (Rust)
│   ├── lib.rs                             # state, program ID, session account layout
│   └── instructions/                      # create / commit / start / callback / close
├── arcium_compute/src/psi.rs              # MXE compute_psi garbled circuit
├── tests/silent_circle.ts                 # Anchor integration tests (ts-mocha)
├── scripts/                               # devnet deploy + env-wiring helpers
├── docs/architecture.md                   # account layout + data-flow details
├── Anchor.toml
├── Cargo.toml
└── .env.example
```

---

## How to Run

### 1. Frontend (no on-chain calls)

```bash
npm install
cp .env.example .env
npm run dev
```

Other commands:

```bash
npm run test          # vitest unit tests (frontend)
npm run lint          # ESLint
npm run build         # production bundle
```

### 2. Full on-chain stack (Anchor + Arcium devnet)

**Prerequisites:** Solana CLI 1.18+, Anchor 0.32+, Arcium CLI.
On Windows, run these inside WSL2:

```bash
npm run setup:wsl:dry-run   # preview WSL toolchain install
npm run setup:wsl           # install Solana + Anchor toolchain in WSL
```

**Deploy:**

```bash
solana airdrop 2                       # fund the deploy keypair
npm run deploy:devnet:dry-run          # preview deploy steps
npm run deploy:devnet                  # anchor build + deploy, writes program ID to .env.local
```

**Wire up Arcium IDs** (after `arcium register-mxe` and
`arcium register-computation arcium_compute/`):

```bash
npm run env:devnet
# or directly:
node scripts/configure-devnet-env.mjs
```

Populate the `VITE_ARCIUM_*` variables printed by `arcium info --cluster devnet`
into `.env.local`, then restart with `npm run dev`.

### 3. Anchor integration tests

```bash
npm run test:anchor    # ts-mocha against devnet
```

The suite covers `create_session`, `commit_set` (happy path, double-join
rejection, expired-session rejection), `compute_psi_callback` (rejects
non-Arcium callers), and `close_session` (requires expiry + initiator
authority + rent refund).

---

## Environment Variables

`.env.example` is the reference. Only `VITE_*` variables are exposed to the
browser bundle.

| Variable | Purpose |
|---|---|
| `VITE_SOLANA_RPC_URL` | Solana RPC endpoint (default: `https://api.devnet.solana.com`) |
| `VITE_SILENT_CIRCLE_PROGRAM_ID` | Deployed program ID — enables on-chain session flow |
| `VITE_ARCIUM_PROGRAM_ID` | Arcium program address on devnet |
| `VITE_ARCIUM_MXE_PUBKEY` | MXE account address |
| `VITE_ARCIUM_MEMPOOL_PUBKEY` | Arcium mempool account |
| `VITE_ARCIUM_EXECPOOL_PUBKEY` | Arcium execution pool account |
| `VITE_ARCIUM_CLUSTER_PUBKEY` | Arcium cluster account (used for callback verification) |
| `VITE_ARCIUM_COMP_DEF_PUBKEY` | `compute_psi` computation-definition account |
| `VITE_ARCIUM_FEE_POOL_PUBKEY` | Arcium fee pool |
| `VITE_ARCIUM_CLOCK_PUBKEY` | Arcium clock account |
| `VITE_ARCIUM_CLUSTER_X25519_PUBKEY_HEX` | Optional 64-char hex of the cluster's X25519 key — skips an RPC call on every `start_psi` |
| `ANCHOR_PROGRAM_ID` | Mirrors the deployed program ID for Anchor tooling |
| `PSI_COMPUTATION_PUBKEY` | `compute_psi` computation pubkey consumed by deploy scripts |
| `ARCIUM_MXE_PUBKEY` | MXE pubkey consumed by deploy scripts |

---

## Implementation Status

**Complete:**

- Vite + React frontend with wallet connect, asset type selection, live SPL
  token / NFT collection / DAO membership fetching from Solana devnet,
  deterministic commitment preview, session PDA polling, and intersection
  match resolution with human-readable asset names.
- Anchor program (`create_session`, `commit_set`, `start_psi`,
  `compute_psi_callback`, `close_session`) deployed at
  `EBohpNnouLq47eK3a3G58bPNdvKaJEjDMHap8u3aavmq` on Solana devnet.
- Client-side X25519 + HKDF + AES-256-GCM encryption of asset fingerprints
  before any data leaves the browser.
- Arcium `compute_psi` garbled-circuit definition: fixed 4×4 PSI over
  SHA-256-derived 64-bit fingerprints, returning up to four matched values.
- Session PDA stores up to 50 intersection hashes; callback verifies Arcium
  cluster signature before writing.
- Mocha integration tests for all five instructions.
- WSL toolchain bootstrap, devnet deploy wrapper, and env-wiring scripts.
- Fully responsive UI from 320 px phones through large desktop displays.
- Live event log tracking every phase from session creation through
  intersection reveal.

**Out of scope (future extensions):**

- Dynamic PSI set sizes beyond the current 4-element fixed circuit.
- ZK proof-of-membership tokens derived from matched fingerprints.
- CPI-based downstream programs that consume the session PDA result.
- Full SPL Governance shared-seat attestations with realm metadata.
