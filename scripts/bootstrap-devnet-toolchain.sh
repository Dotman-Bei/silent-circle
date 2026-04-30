#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOLANA_BIN_DIR="$HOME/.local/share/solana/install/active_release/bin"
CARGO_ENV_FILE="$HOME/.cargo/env"
SHELL_RC_FILE="$HOME/.bashrc"

log() {
  printf '[bootstrap-devnet] %s\n' "$1"
}

append_line_if_missing() {
  local file_path="$1"
  local line="$2"

  touch "$file_path"

  if ! grep -Fqx "$line" "$file_path"; then
    printf '%s\n' "$line" >> "$file_path"
  fi
}

log "Bootstrapping Rust, Solana CLI, and Anchor inside WSL."

if ! command -v cargo >/dev/null 2>&1; then
  log "Installing rustup and the stable Rust toolchain."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi

# shellcheck disable=SC1090
source "$CARGO_ENV_FILE"

if ! command -v solana >/dev/null 2>&1; then
  log "Installing Solana CLI stable release."
  sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
fi

append_line_if_missing "$SHELL_RC_FILE" 'export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"'
export PATH="$HOME/.cargo/bin:$SOLANA_BIN_DIR:$PATH"

if ! command -v avm >/dev/null 2>&1; then
  log "Installing Anchor Version Manager."
  cargo install --git https://github.com/coral-xyz/anchor avm --locked
fi

log "Selecting the latest Anchor toolchain."
avm install latest
avm use latest

if ! command -v anchor >/dev/null 2>&1; then
  export PATH="$HOME/.avm/bin:$PATH"
  append_line_if_missing "$SHELL_RC_FILE" 'export PATH="$HOME/.avm/bin:$PATH"'
fi

if ! command -v arcium >/dev/null 2>&1; then
  log "Installing Arcium CLI (per SKILL §2)."
  if ! cargo install arcium-cli 2>/dev/null; then
    log "Note: 'cargo install arcium-cli' failed. The Arcium CLI may have moved off crates.io."
    log "Check https://docs.arcium.com for the current install command (e.g. via npm or a release binary)."
    log "The deploy can still proceed; you only need the Arcium CLI for register-mxe / register-computation."
  fi
fi

log "Configuring Solana for devnet."
solana config set --url devnet

if [ ! -f "$HOME/.config/solana/id.json" ]; then
  log "Creating a devnet keypair."
  mkdir -p "$HOME/.config/solana"
  solana-keygen new --outfile "$HOME/.config/solana/id.json" --no-bip39-passphrase
fi

log "Toolchain bootstrap complete."
printf '\n'
printf 'Next commands:\n'
printf '  cd %q\n' "$REPO_ROOT"
printf '  npm install\n'
printf '  npm run deploy:devnet:dry-run\n'
printf '  npm run deploy:devnet\n'