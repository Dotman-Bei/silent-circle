use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod instructions;

pub use errors::*;
// Account types and instruction helpers are re-exported from the instructions module.
// Function names are NOT re-exported here to avoid ambiguous glob re-exports with
// the `#[arcium_program]` macro, which exposes them via the program module.
pub use instructions::{CloseSession, CommitSet, ComputePsiCallback, CreateSession, InitComputePsiCompDef, StartPsi};

declare_id!("63CgPfSVhEgg4Gvrq6E8FUbG68awnnmvUai64hqzsgdb");

/// Byte offset to `encrypted_state` inside the serialised `Session` account
/// (after the 8-byte Anchor discriminator).
///
/// Layout (Borsh, no alignment padding):
///   8   discriminator
///  32   wallet_a
///  32   wallet_b
///  32   commitment_a
///  32   commitment_b
///   8   arcium_task_id
///   1   state (enum)
///   1   asset_mask
///   8   created_at
///   8   expires_at
///   1   bump
///  16   state_nonce   ← placed before encrypted_state so offsets are stable
/// ---
/// 179   ← ENCRYPTED_STATE_OFFSET
pub const ENCRYPTED_STATE_OFFSET: u32 = 179;

/// 18 encrypted [u8;32] ciphertexts:
///   4 × encrypted u64  for set_a items
///   1 × encrypted u8   for set_a count
///   4 × encrypted u64  for set_b items
///   1 × encrypted u8   for set_b count
///   (initialised by init_psi_state, updated by submit_set callbacks)
pub const ENCRYPTED_STATE_LEN: u32 = 18 * 32; // 576 bytes

/// comp_def_offset for the single PSI computation definition.
/// Must match the function name in arcium_compute/src/psi.rs.
pub const COMP_DEF_OFFSET_COMPUTE_PSI: u32 = comp_def_offset("compute_psi");

pub const MAX_INTERSECTION_ITEMS: usize = 50;

/// SESSION_SPACE must accommodate all fixed fields + variable intersection Vec.
/// Fixed: 179 (above) + 576 (encrypted_state) = 755 bytes
/// Variable: 4-byte Vec header + up to 50 × 32-byte intersection hashes = 1604
pub const SESSION_SPACE: usize =
    755 + 4 + (MAX_INTERSECTION_ITEMS * 32);

#[arcium_program]
pub mod silent_circle {
    use super::*;

    // ── One-time setup ────────────────────────────────────────────────────────

    /// Initialises the on-chain computation-definition account for `compute_psi`.
    /// Call once after deploying the program.
    pub fn init_compute_psi_comp_def(ctx: Context<InitComputePsiCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // ── Session lifecycle ─────────────────────────────────────────────────────

    pub fn create_session(
        ctx: Context<CreateSession>,
        session_id: [u8; 8],
        commitment_a: [u8; 32],
        asset_mask: u8,
        expires_at: i64,
    ) -> Result<()> {
        instructions::create_session(ctx, session_id, commitment_a, asset_mask, expires_at)
    }

    pub fn commit_set(ctx: Context<CommitSet>, commitment_b: [u8; 32]) -> Result<()> {
        instructions::commit_set(ctx, commitment_b)
    }

    /// Triggers the Arcium PSI computation.
    ///
    /// The caller supplies both wallets' asset fingerprints (first 8 bytes of
    /// SHA-256 of each mint address), each encrypted under the MXE cluster key
    /// via X25519 key exchange. The MXE decrypts inside the garbled circuit and
    /// returns ONLY the intersection via the `write_intersection` callback.
    pub fn start_psi(
        ctx: Context<StartPsi>,
        computation_offset: u64,
        set_a_items: [[u8; 32]; 4],
        set_a_count: [u8; 32],
        set_a_pubkey: [u8; 32],
        set_a_nonce: u128,
        set_b_items: [[u8; 32]; 4],
        set_b_count: [u8; 32],
        set_b_pubkey: [u8; 32],
        set_b_nonce: u128,
    ) -> Result<()> {
        instructions::start_psi(
            ctx,
            computation_offset,
            set_a_items,
            set_a_count,
            set_a_pubkey,
            set_a_nonce,
            set_b_items,
            set_b_count,
            set_b_pubkey,
            set_b_nonce,
        )
    }

    /// Arcium callback — called by the MXE after PSI completes.
    #[arcium_callback(encrypted_ix = "compute_psi")]
    pub fn write_intersection(
        ctx: Context<ComputePsiCallback>,
        output: SignedComputationOutputs<ComputePsiOutput>,
    ) -> Result<()> {
        instructions::write_intersection(ctx, output)
    }

    /// Reclaims the session PDA's rent back to wallet A.
    /// Only callable once the session is expired or in a terminal state.
    pub fn close_session(ctx: Context<CloseSession>) -> Result<()> {
        instructions::close_session(ctx)
    }
}

// ── State ─────────────────────────────────────────────────────────────────────

#[account]
pub struct Session {
    pub wallet_a: Pubkey,
    pub wallet_b: Pubkey,
    pub commitment_a: [u8; 32],
    pub commitment_b: [u8; 32],
    /// Stores the computation_offset used for the Arcium task.
    pub arcium_task_id: u64,
    pub state: SessionState,
    pub asset_mask: u8,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
    /// Arcium MXE state nonce — stored before encrypted_state so its offset
    /// remains stable even as the variable-length intersection Vec grows.
    pub state_nonce: u128,
    /// Variable-length intersection written by the write_intersection callback.
    pub intersection: Vec<[u8; 32]>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SessionState {
    AwaitingCounterparty,
    BothCommitted,
    Computing,
    Done,
    Expired,
}

#[event]
pub struct IntersectionReady {
    pub session: Pubkey,
    pub count: u8,
}

/// Output type for the `compute_psi` Arcium computation.
///
/// Arcium's macro system generates this from the arcis function signature:
///   `fn compute_psi(...) -> [u64; 4]`
/// → `ComputePsiOutput { field_0: [u64; 4] }`
///
/// Each non-zero u64 in `field_0` is a mint fingerprint (first 8 bytes of
/// SHA-256) that appears in both wallets' asset sets.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ComputePsiOutput {
    pub field_0: [u64; 4],
}

// ── One-time setup context ────────────────────────────────────────────────────

#[init_computation_definition_accounts("compute_psi", payer)]
#[derive(Accounts)]
pub struct InitComputePsiCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account verified by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table verified by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
