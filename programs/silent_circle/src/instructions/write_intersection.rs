use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::{
    IntersectionReady, SilentCircleError, Session, SessionState,
    COMP_DEF_OFFSET_COMPUTE_PSI,
};

// The #[callback_accounts] macro internally references `ErrorCode::ClusterNotSet`.
// Alias our local enum so the macro expansion resolves to our variant rather than
// to anchor_lang's ErrorCode (which has no ClusterNotSet variant).
use crate::SilentCircleError as ErrorCode;

/// Accounts for the Arcium PSI callback.
///
/// Named `ComputePsiCallback` as required by the `#[callback_accounts("compute_psi")]` macro.
#[callback_accounts("compute_psi")]
#[derive(Accounts)]
pub struct ComputePsiCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPUTE_PSI))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account verified by the Arcium program in callback context.
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar verified by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    /// The session account whose intersection will be written.
    #[account(mut)]
    pub session: Account<'info, Session>,
}

/// Arcium callback — invoked by the MXE after `compute_psi` completes.
///
/// The `output` contains the [u64; 4] intersection result, where each non-zero
/// u64 is the first 8 bytes of a SHA-256 mint hash held by both wallets.
/// We expand each fingerprint back to a zero-padded [u8; 32] for storage.
pub fn write_intersection(
    ctx: Context<ComputePsiCallback>,
    output: SignedComputationOutputs<ComputePsiOutput>,
) -> Result<()> {
    // Verify the output signature — rejects any result not from the Arcium MXE.
    let intersection_u64s = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(ComputePsiOutput { field_0 }) => field_0,
        Err(_) => return err!(SilentCircleError::InvalidState),
    };

    let s = &mut ctx.accounts.session;

    // Convert each non-zero u64 fingerprint to a 32-byte hash representation.
    // The first 8 bytes contain the fingerprint; the remaining 24 bytes are zero.
    s.intersection = intersection_u64s
        .iter()
        .filter(|&&x| x != 0)
        .map(|&x| {
            let mut hash = [0u8; 32];
            hash[..8].copy_from_slice(&x.to_le_bytes());
            hash
        })
        .collect();

    s.state = SessionState::Done;

    emit!(IntersectionReady {
        session: ctx.accounts.session.key(),
        count: s.intersection.len() as u8,
    });

    Ok(())
}
