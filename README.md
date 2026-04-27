# SilentCircle

SilentCircle is a private wallet discovery app for Solana. Two wallets prepare masked asset sets, commit them to a shared session, and aim to reveal only the overlap rather than either full portfolio.

This repository now contains two layers of the project:

- A Vite frontend that can connect a wallet, fetch live SPL token mint counts on devnet, generate base58 invite session IDs, compute deterministic commitment previews, and package a structured session payload.
- A scaffolded Anchor plus Arcium workspace that matches the intended project layout for session accounts and PSI execution, ready to be completed once the Rust and Anchor toolchains are installed locally.

## Why Arcium Matters

Without MPC, one wallet has to reveal its holdings either to the counterparty or to a server that performs the comparison. SilentCircle is designed so only the intersection should be revealed.

Arcium's execution model is the missing privacy layer for the final product. The frontend prepares hashed asset identifiers and session commitments, the Anchor program stores session state, and the Arcium computation is intended to run Private Set Intersection over encrypted sets.

## Architecture

SilentCircle is split into three layers:

1. Frontend: Vite React app in [src](src) for wallet connection, asset selection, invite links, commitment preview, and session status.
2. Solana program: Anchor workspace in [programs/silent_circle](programs/silent_circle) for session PDA creation, counterparty commits, PSI start, and callback writes.
3. Arcium compute: computation crate in [arcium_compute](arcium_compute) for Private Set Intersection over hashed asset identifiers.

Additional architecture notes live in [docs/architecture.md](docs/architecture.md).

## Current Status

Implemented now:

- Base58 session IDs and reusable session helpers.
- Asset-mask utilities for tokens, NFT collections, and DAO memberships.
- Shared Solana client utilities backed by `@solana/web3.js`.
- Live SPL token mint count fetching from Solana devnet.
- Live NFT collection fetching via token metadata account parsing.
- Live DAO membership fetching via SPL Governance token-owner records.
- Deterministic live commitment previews over canonicalized SPL token mint IDs, NFT collection IDs, and DAO realm IDs.
- Structured session payload generation for future `create_session` instruction calls.
- Repository scaffolding for Anchor and Arcium crates.

Still incomplete:

- Real encryption with the Arcium SDK.
- Actual Anchor builds, deployment, and instruction calls.
- Arcium computation deployment and task orchestration.

## Local Development

### Frontend

Install Node dependencies and run the Vite app:

```bash
npm install
npm run dev
```

Create a local `.env` from [.env.example](.env.example) if you need to override the Solana RPC URL.

Useful commands:

```bash
npm run test
npm run build
```

### Anchor and Arcium Workspace

The workspace files are present, but this machine does not currently have `cargo` or `anchor` installed. That means the Rust side has been scaffolded in the repository but not compiled here.

To continue the on-chain build, install at least:

```bash
# Rust toolchain
rustup default stable

# Solana CLI
solana --version

# Anchor CLI
anchor --version
```

Once those tools are available, the next expected commands are:

```bash
anchor build
anchor test --provider.cluster devnet
```

### Deploy a Real Devnet Program ID

`Join on-chain` becomes real only after the Anchor program in [programs/silent_circle/src/lib.rs](programs/silent_circle/src/lib.rs) is deployed and the frontend points at that deployed address through `VITE_SILENT_CIRCLE_PROGRAM_ID`.

On Windows, run the Solana and Anchor install commands from WSL2 or another Unix-like shell.

If this machine is missing a usable WSL setup, start with the checked-in bootstrap helpers.

```bash
npm run setup:wsl:dry-run
```

Then, from an elevated PowerShell session:

```bash
npm run setup:wsl
```

After Windows finishes installing the distro, open that distro once and run:

```bash
bash /mnt/c/Users/bamig/Documents/VIBE\ CODE/SILENT\ CIRCLE/scripts/bootstrap-devnet-toolchain.sh
```

1. Install and configure the toolchain.

```bash
rustup default stable
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest
```

The WSL bootstrap script above performs the same Rust, Solana CLI, and Anchor installation sequence and prints the next repo-local deploy commands when it finishes.

2. Fund the deployer wallet on devnet.

```bash
solana airdrop 2
```

3. Preview the deploy wrapper if you want to confirm the runner and paths first.

```bash
npm run deploy:devnet:dry-run
```

For optional flags such as `--wsl-distro`, run the Node entrypoint directly on Windows so the argument names are preserved.

4. Run the actual deploy wrapper.

```bash
npm run deploy:devnet
```

The wrapper runs `anchor build`, `anchor keys sync`, `anchor build`, and `anchor deploy --provider.cluster devnet`, then reads `target/deploy/silent_circle-keypair.json` and updates `.env.local` through `npm run env:devnet` automatically.

5. If you already have the Arcium IDs, pass them to the wrapper during deploy or rerun the env helper afterward.

```bash
node scripts/deploy-devnet.mjs \
	--wsl-distro Ubuntu \
	--psi-computation-pubkey <your deployed computation pubkey> \
	--mxe-pubkey <your registered mxe pubkey>
```

Manual fallback if you already deployed elsewhere and only want to wire the frontend:

```bash
node scripts/configure-devnet-env.mjs \
	--program-id <your deployed devnet program id> \
	--psi-computation-pubkey <your deployed computation pubkey> \
	--mxe-pubkey <your registered mxe pubkey>
```

That helper creates or updates `.env.local`, sets `VITE_SILENT_CIRCLE_PROGRAM_ID`, keeps the RPC pointed at devnet by default, and mirrors the same program ID into `ANCHOR_PROGRAM_ID` for local consistency.

If you want to write to a different file during testing, use `--output-env-file tmp/devnet.env`.

6. Restart the frontend.

```bash
npm run dev
```

At that point, session creation and join flows can target your deployed Anchor program instead of local-only mode.

Current limitation: `start_psi` is still not end-to-end until the Arcium-side placeholders are replaced with real values as well. The checked-in Rust program still uses a placeholder `ARCIUM_PROGRAM_ID`, and `.env.example` still carries placeholder `PSI_COMPUTATION_PUBKEY` and `ARCIUM_MXE_PUBKEY` values.

## Environment Variables

The checked-in example file is [.env.example](.env.example).

Current variables:

- `VITE_SOLANA_RPC_URL`: frontend Solana RPC endpoint.
- `VITE_SILENT_CIRCLE_PROGRAM_ID`: deployed SilentCircle program ID used by the browser to switch from local join flow to on-chain join flow.
- `ANCHOR_PROGRAM_ID`: intended Anchor program ID.
- `PSI_COMPUTATION_PUBKEY`: intended Arcium computation public key.
- `ARCIUM_MXE_PUBKEY`: intended Arcium MXE public key.

## Repo Layout

```text
.
├── src/                     # Vite frontend
├── programs/silent_circle/  # Anchor program scaffold
├── arcium_compute/          # Arcium computation scaffold
├── docs/                    # Architecture notes
├── tests/                   # Placeholder Anchor integration test location
├── Anchor.toml
├── Cargo.toml
└── .env.example
```

## Next Steps

1. Wire the frontend session draft into real Anchor instruction clients.
2. Install Rust, Solana, and Anchor locally, then complete the on-chain build and Arcium integration.
3. Reduce the remaining large browser chunks created by Solana and metadata client code paths.
