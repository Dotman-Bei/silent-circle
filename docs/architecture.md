# SilentCircle Architecture

SilentCircle has three layers:

1. Vite frontend for wallet connection, asset selection, invite links, and session status.
2. Anchor program for session PDAs, commitments, state transitions, and intersection storage.
3. Arcium computation crate for Private Set Intersection over hashed asset identifiers.

Current status:

- The frontend exists and now computes live commitment previews for SPL token mints.
- The Anchor and Arcium directories are scaffolded but cannot be compiled in this environment because `cargo` and `anchor` are not installed.