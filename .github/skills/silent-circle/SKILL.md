---
name: silent-circle
description: >
  Build SilentCircle — a private mutual wallet/token discovery app on Solana using Arcium's
  Multi-Party Computation (MPC) and Private Set Intersection (PSI). Use this skill whenever
  the user wants to scaffold, extend, debug, or submit the SilentCircle RTG project. Covers
  full-stack implementation: Anchor program (Solana), Arcium MXE computation definition (Rust),
  Next.js frontend (TypeScript), SPL/NFT/DAO asset fetching, session invite flow, match result
  UI, README writing, and RTG submission preparation. Trigger this skill for any task involving
  SilentCircle's codebase, architecture questions, Arcium SDK integration, PSI logic, Solana
  PDA design, or judging-criteria optimisation for the Arcium RTG.
---

# SilentCircle — Build Skill

Two Solana wallets discover shared tokens, NFTs, and DAO memberships without either wallet
ever exposing its full holdings. Arcium's MXE runs Private Set Intersection (PSI) over
both encrypted asset lists; only the intersection is revealed. This guide takes you from
zero to a working, submittable RTG entry.

---

## 1. Project Map

```
silentcircle/
├── programs/
│   └── silent_circle/          # Anchor program (Rust)
│       └── src/
│           ├── lib.rs           # Program entrypoint + state
│           ├── instructions/
│           │   ├── create_session.rs
│           │   ├── commit_set.rs
│           │   ├── start_psi.rs
│           │   └── write_intersection.rs
│           └── errors.rs
├── arcium_compute/             # Arcium MXE computation (Rust)
│   └── src/
│       └── psi.rs              # PSI logic, compiled to MXE
├── app/                        # Next.js 14 frontend (TypeScript)
│   ├── lib/
│   │   ├── encrypt.ts          # Client-side set encryption
│   │   ├── assets.ts           # SPL / NFT / DAO fetching
│   │   └── session.ts          # Session state + invite links
│   ├── components/
│   │   ├── SetupScreen.tsx
│   │   ├── ComputingScreen.tsx
│   │   └── MatchResultScreen.tsx
│   └── pages/
│       ├── index.tsx
│       └── session/[id].tsx
├── tests/
│   └── silent_circle.ts        # Anchor integration tests
├── docs/
│   └── architecture.md         # README content + diagrams
├── Anchor.toml
├── Cargo.toml
└── README.md
```

---

## 2. Environment Setup

**Prerequisites — install in this order:**

```bash
# 1. Solana CLI (1.18+)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json

# 2. Anchor CLI (0.30+)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# 3. Arcium CLI + SDK
cargo install arcium-cli
npm install @arcium/sdk @arcium/anchor-idl

# 4. Node / frontend deps
cd app && npm install
```

**Scaffold the Anchor project:**

```bash
anchor init silent_circle --typescript
cd silent_circle
anchor add arcium  # adds arcium-cpi crate to Cargo.toml
```

**Arcium devnet registration:**

```bash
arcium register-mxe --cluster devnet
# Note the returned MXE_PUBKEY — add to .env and Anchor.toml
```

---

## 3. Solana Program (Anchor)

### 3a. Session State (lib.rs)

The Anchor program owns one account per session: a PDA that stores both wallets'
commitment hashes, tracks state, and receives the intersection back from Arcium.

```rust
// programs/silent_circle/src/lib.rs
use anchor_lang::prelude::*;

#[account]
pub struct Session {
    pub wallet_a:        Pubkey,        // initiator
    pub wallet_b:        Pubkey,        // counterparty (set on join)
    pub commitment_a:    [u8; 32],      // SHA-256 of encrypted set A
    pub commitment_b:    [u8; 32],      // SHA-256 of encrypted set B
    pub arcium_task_id:  u64,           // returned by commission_computation
    pub state:           SessionState,
    pub intersection:    Vec<[u8; 32]>, // mint hash list written by Arcium callback
    pub asset_mask:      u8,            // bitmask: tokens=0b001 nfts=0b010 daos=0b100
    pub created_at:      i64,
    pub expires_at:      i64,           // created_at + 24h
    pub bump:            u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum SessionState {
    AwaitingCounterparty,
    BothCommitted,
    Computing,
    Done,
    Expired,
}
```

**PDA seed:** `["session", session_id_bytes]` — where `session_id` is a `[u8; 8]`
generated client-side via `crypto.getRandomValues`. Store it in the invite link as
a base58 string.

### 3b. Instructions

**create_session** — Wallet A initialises the PDA, stores its commitment and asset mask.

```rust
pub fn create_session(
    ctx: Context<CreateSession>,
    session_id: [u8; 8],
    commitment_a: [u8; 32],
    asset_mask: u8,
    expires_at: i64,
) -> Result<()> {
    let s = &mut ctx.accounts.session;
    s.wallet_a      = ctx.accounts.signer.key();
    s.commitment_a  = commitment_a;
    s.asset_mask    = asset_mask;
    s.state         = SessionState::AwaitingCounterparty;
    s.created_at    = Clock::get()?.unix_timestamp;
    s.expires_at    = expires_at;
    s.bump          = ctx.bumps.session;
    Ok(())
}
```

**commit_set** — Wallet B joins via invite link, stores its commitment.

```rust
pub fn commit_set(
    ctx: Context<CommitSet>,
    commitment_b: [u8; 32],
) -> Result<()> {
    let s = &mut ctx.accounts.session;
    require!(s.state == SessionState::AwaitingCounterparty, SilentCircleError::InvalidState);
    require!(s.wallet_b == Pubkey::default(), SilentCircleError::AlreadyJoined);
    s.wallet_b  = ctx.accounts.signer.key();
    s.commitment_b = commitment_b;
    s.state     = SessionState::BothCommitted;
    Ok(())
}
```

**start_psi** — Either wallet triggers PSI once both have committed.

```rust
pub fn start_psi(ctx: Context<StartPsi>) -> Result<()> {
    let s = &mut ctx.accounts.session;
    require!(s.state == SessionState::BothCommitted, SilentCircleError::InvalidState);

    let task_id = arcium_cpi::commission_computation(
        ctx.accounts.arcium_program.to_account_info(),
        PSI_COMPUTATION_PUBKEY,   // from Anchor.toml / env
        vec![s.commitment_a, s.commitment_b],
        Some(write_intersection_callback_cpi(&ctx)),
    )?;

    s.arcium_task_id = task_id;
    s.state = SessionState::Computing;
    Ok(())
}
```

**write_intersection** — Arcium calls this via CPI as the post-execution success callback.

```rust
pub fn write_intersection(
    ctx: Context<WriteIntersection>,
    intersection: Vec<[u8; 32]>,
) -> Result<()> {
    require!(
        ctx.accounts.caller.key() == ARCIUM_PROGRAM_ID,
        SilentCircleError::UnauthorisedCallback
    );
    let s = &mut ctx.accounts.session;
    s.intersection = intersection;
    s.state = SessionState::Done;
    emit!(IntersectionReady {
        session: ctx.accounts.session.key(),
        count: s.intersection.len() as u8,
    });
    Ok(())
}
```

---

## 4. Arcium MXE Computation (psi.rs)

This file is compiled separately and deployed to the Arcium network. It runs inside
a garbled circuit — no single Arx node sees either input in plaintext.

```rust
// arcium_compute/src/psi.rs
use arcium_sdk::computation::prelude::*;

/// Private Set Intersection over SHA-256 hashed mint addresses.
/// Both sets arrive encrypted under the MXE cluster key.
/// Output: mints present in BOTH sets (the intersection).
#[arcium_computation(name = "silent_circle_psi", version = 1)]
pub fn private_set_intersection(
    set_a: EncryptedVec<[u8; 32]>,   // encrypted mint hashes from wallet A
    set_b: EncryptedVec<[u8; 32]>,   // encrypted mint hashes from wallet B
) -> Vec<[u8; 32]> {
    // Executed inside MXE — plaintext never leaves the garbled circuit
    set_a.iter()
        .filter(|item| set_b.contains(item))
        .cloned()
        .collect()
}
```

**Deploy the computation:**

```bash
arcium deploy-computation arcium_compute/src/psi.rs \
  --name silent_circle_psi \
  --cluster devnet
# Save the returned COMPUTATION_PUBKEY to .env as PSI_COMPUTATION_PUBKEY
```

---

## 5. Client-Side Asset Fetching & Encryption (TypeScript)

### 5a. Fetch token sets (assets.ts)

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Metaplex } from '@metaplex-foundation/js';

export async function fetchAssetMints(
  connection: Connection,
  wallet: PublicKey,
  mask: number            // bitmask: 0b001=tokens 0b010=nfts 0b100=daos
): Promise<PublicKey[]> {
  const mints: PublicKey[] = [];
  const mx = Metaplex.make(connection);

  if (mask & 0b001) {
    // SPL fungible tokens
    const accounts = await connection.getTokenAccountsByOwner(wallet, {
      programId: TOKEN_PROGRAM_ID,
    });
    for (const { account } of accounts.value) {
      const mint = new PublicKey(account.data.slice(0, 32));
      mints.push(mint);
    }
  }

  if (mask & 0b010) {
    // NFT collections — group by collection key, not individual mint
    const nfts = await mx.nfts().findAllByOwner({ owner: wallet });
    for (const nft of nfts) {
      const collectionKey = nft.collection?.address;
      if (collectionKey && !mints.some(m => m.equals(collectionKey))) {
        mints.push(collectionKey);
      }
    }
  }

  if (mask & 0b100) {
    // DAO memberships via SPL Governance — fetch token owner records
    const daoMints = await fetchGovernanceMemberships(connection, wallet);
    mints.push(...daoMints);
  }

  return [...new Set(mints.map(m => m.toBase58()))].map(s => new PublicKey(s));
}
```

### 5b. Encrypt set before submission (encrypt.ts)

```typescript
import { getMXEPublicKey, encryptForMXE } from '@arcium/sdk';
import { createHash } from 'crypto';

export async function buildEncryptedCommitment(
  mints: PublicKey[],
  sessionId: string
): Promise<{ encryptedSet: Uint8Array; commitment: Uint8Array }> {
  // Hash each mint to a fixed 32-byte value
  const hashed = mints.map(m =>
    createHash('sha256').update(m.toBuffer()).digest()
  );

  // Encode as flat byte array: [hash0 | hash1 | ... | hashN]
  const raw = Buffer.concat(hashed);

  // Fetch MXE cluster public key for this devnet session
  const mxePubKey = await getMXEPublicKey({ cluster: 'devnet', sessionId });

  // Encrypt under MXE key — only the MXE cluster can decrypt
  const encryptedSet = await encryptForMXE(raw, mxePubKey);

  // Commitment = SHA-256(encryptedSet) — stored on-chain, proves input without revealing it
  const commitment = createHash('sha256').update(encryptedSet).digest();

  return { encryptedSet, commitment };
}
```

---

## 6. Frontend Flow (Next.js)

Three screens, one `sessionId` in the URL throughout.

### Screen 1 — Setup (SetupScreen.tsx)

- Wallet connect via `@solana/wallet-adapter-react`
- Asset mask checkboxes: Tokens / NFT Collections / DAO memberships
- On submit: call `buildEncryptedCommitment`, call `createSession` instruction,
  generate invite URL: `https://silentcircle.xyz/session/<base58_session_id>`
- Copy-to-clipboard button on the link

### Screen 2 — Computing (ComputingScreen.tsx)

- Polled via `connection.getAccountInfo(sessionPDA)` every 3 seconds
- Show: "Wallet A committed ✓", "Wallet B committed ✓", PSI progress bar
- Static reminder text: *"Your holdings are never transmitted. Arcium's MPC
  reveals only what you share."* — this line answers the judges' UX criterion.
- When state transitions to `Done`, auto-advance to Screen 3

### Screen 3 — Match Result (MatchResultScreen.tsx)

- Decode `session.intersection` (array of 32-byte mint hashes)
- Resolve each hash back to a human-readable name:
  - SPL tokens: lookup against Jupiter token list
  - NFTs: Metaplex `findByMint` for collection name
  - DAOs: Realms governance list
- Render each match as a card with icon + name + type badge
- CTA: "Message on dialect" (Dialect chat deep-link) or "Copy session proof"
- Footer: "Neither wallet saw the other's full portfolio."

---

## 7. Invite Link & Session Handshake

```typescript
// lib/session.ts
import { nanoid } from 'nanoid';

export function generateSessionId(): Uint8Array {
  // 8 random bytes encoded as base58 in the URL
  const id = new Uint8Array(8);
  crypto.getRandomValues(id);
  return id;
}

export function buildInviteUrl(sessionId: Uint8Array): string {
  const b58 = bs58.encode(sessionId);
  return `${process.env.NEXT_PUBLIC_BASE_URL}/session/${b58}`;
}
```

When Wallet B opens the invite link:
1. App reads `sessionId` from URL
2. Fetches session PDA — confirms state is `AwaitingCounterparty`
3. Wallet B connects, selects asset mask (can differ from A's)
4. B's client fetches + encrypts its set, calls `commit_set`
5. Either party can now call `start_psi`

---

## 8. Testing

```typescript
// tests/silent_circle.ts
import * as anchor from '@coral-xyz/anchor';
import { assert } from 'chai';

describe('SilentCircle', () => {
  it('creates a session PDA with correct state', async () => {
    const [sessionPDA] = await deriveSessionPDA(sessionId);
    await program.methods
      .createSession(sessionId, commitment_a, MASK_TOKENS, expires_at)
      .accounts({ session: sessionPDA, signer: walletA.publicKey })
      .signers([walletA])
      .rpc();
    const session = await program.account.session.fetch(sessionPDA);
    assert.equal(session.state.awaitingCounterparty !== undefined, true);
    assert.deepEqual(session.commitmentA, commitment_a);
  });

  it('rejects a second commit from wallet A', async () => {
    // wallet B joins first, then wallet A tries to join again — must fail
    ...
  });

  it('transitions state to Computing after start_psi', async () => { ... });

  it('write_intersection rejects non-Arcium callers', async () => { ... });
});
```

Run tests against devnet:

```bash
anchor test --provider.cluster devnet
```

---

## 9. README — Critical Sections for Judging

The README is scored under the Clarity criterion. Write these four sections explicitly:

**Section 1 — What SilentCircle does (2–3 sentences)**
Lead with the problem, not the tech. "Two Solana wallets can't safely compare holdings
without one revealing everything to the other or to a server."

**Section 2 — Why Arcium is necessary (required by judging rubric)**
Explain: without MPC, one wallet must trust the other or a centralised server.
Arcium's garbled circuit PSI means no single node — not even Arcium — ever sees
either wallet's full asset list. Removing Arcium makes the privacy guarantee collapse.

**Section 3 — Architecture diagram**
Embed the three-layer diagram: Frontend → Solana Anchor → Arcium MXE.
Show the data flow: client encrypts → commits hash on-chain → Arcium runs PSI →
callback writes intersection → UI displays match.

**Section 4 — How to run locally**
```bash
anchor build && anchor deploy --provider.cluster devnet
cd app && npm run dev
```
Include a `.env.example`. Never commit `.env`.

---

## 10. Submission Checklist

Before submitting to the Arcium RTG form:

- [ ] PSI actually runs on Arcium devnet (not mocked) — verify with `arcium task-status <task_id>`
- [ ] Anchor program deployed to devnet — save program ID
- [ ] GitHub repo is public and open-source
- [ ] README has all four sections from §9 above
- [ ] Demo video: wallet A setup → share link → wallet B joins → computing screen → match card (≤ 2 min)
- [ ] Submission form fields: project name, one-paragraph description, GitHub URL, demo URL, all in English
- [ ] `.env.example` present; no secrets committed
- [ ] NFT collection matching AND DAO membership matching implemented (not just SPL tokens)
  — this is your primary Innovation differentiator over basic submissions

**One-paragraph submission description (copy-paste template):**
> SilentCircle lets two Solana wallet holders discover shared tokens, NFT collections, and DAO
> memberships without either party revealing their full holdings. Arcium's Multi-Party Execution
> Environment runs Private Set Intersection over two encrypted asset sets; only the intersection
> is returned — no node, server, or counterparty ever sees a complete portfolio. Built with Anchor,
> the Arcium SDK, and Next.js, it targets OTC traders, DAO coalition builders, and anyone needing
> verified on-chain common ground without sacrificing financial privacy.

---

## 11. Common Pitfalls

| Symptom | Fix |
|---|---|
| `write_intersection` called by wrong signer | Add `require!(caller == ARCIUM_PROGRAM_ID)` guard |
| Mint hashes don't match between wallets | Hash the canonical mint `toBuffer()` on both sides before encrypting — don't hash the base58 string |
| NFT PSI too noisy (100s of matches) | Group by `collection.address`, not individual mint |
| `commission_computation` returns 0x177 error | MXE not registered on devnet — re-run `arcium register-mxe` |
| Session PDA size overflow on intersection | Allocate max 50 matches in `#[account(init, space = ...)]` — prune server-side if needed |
| Frontend shows stale state | Poll `getAccountInfo` on session PDA; don't rely on websocket subscriptions alone on devnet |

---

## 12. Extending Beyond the RTG

Once the core submission is done, these additions lift the real-world story significantly:

- **Dialect integration** — after match, open an encrypted Dialect thread between the two wallets
- **Session expiry enforcement** — add a `close_session` instruction that reclaims rent after `expires_at`
- **Multi-round discovery** — allow both parties to run a second PSI after the first, with a refined mask
- **ZK proof of membership** — generate a Groth16 proof that a wallet holds a specific matched asset,
  usable as an access token for gated Discord servers or dApps