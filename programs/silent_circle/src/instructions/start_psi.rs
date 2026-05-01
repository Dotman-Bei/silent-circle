use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::{
    ArciumSignerAccount, SilentCircleError, Session, SessionState, ComputePsiCallback,
    COMP_DEF_OFFSET_COMPUTE_PSI, ID, ID_CONST,
};

/// Context for the `start_psi` instruction.
///
/// The `#[queue_computation_accounts]` attribute injects the standard set of
/// Arcium infrastructure accounts required by `queue_computation` (mxe_account,
/// mempool_account, executing_pool, computation_account, comp_def_account,
/// cluster_account, pool_account, clock_account, sign_pda_account,
/// arcium_program, system_program).
#[queue_computation_accounts("compute_psi", signer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct StartPsi<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub session: Account<'info, Session>,
    #[account(
        init_if_needed,
        space = 9,
        payer = signer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, SilentCircleError::ClusterNotSet))]
    /// CHECK: mempool_account verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, SilentCircleError::ClusterNotSet))]
    /// CHECK: executing_pool verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, SilentCircleError::ClusterNotSet))]
    /// CHECK: computation_account verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPUTE_PSI))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, SilentCircleError::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[allow(clippy::too_many_arguments)]
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
    // Validate using immutable access — mutable borrow comes later.
    require!(
        ctx.accounts.session.state == SessionState::BothCommitted,
        SilentCircleError::InvalidState
    );
    require!(
        Clock::get()?.unix_timestamp <= ctx.accounts.session.expires_at,
        SilentCircleError::SessionExpired
    );

    let signer = ctx.accounts.signer.key();
    require!(
        signer == ctx.accounts.session.wallet_a || signer == ctx.accounts.session.wallet_b,
        SilentCircleError::UnauthorizedStart
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Capture values needed from accounts before queue_computation borrows ctx.accounts.
    let session_key = ctx.accounts.session.key();
    let callback_ixs = vec![ComputePsiCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &[CallbackAccount {
            pubkey: session_key,
            is_writable: true,
        }],
    )?];

    let args = ArgBuilder::new()
        .x25519_pubkey(set_a_pubkey)
        .plaintext_u128(set_a_nonce)
        .encrypted_u64(set_a_items[0])
        .encrypted_u64(set_a_items[1])
        .encrypted_u64(set_a_items[2])
        .encrypted_u64(set_a_items[3])
        .encrypted_u8(set_a_count)
        .x25519_pubkey(set_b_pubkey)
        .plaintext_u128(set_b_nonce)
        .encrypted_u64(set_b_items[0])
        .encrypted_u64(set_b_items[1])
        .encrypted_u64(set_b_items[2])
        .encrypted_u64(set_b_items[3])
        .encrypted_u8(set_b_count)
        .build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        callback_ixs,
        1,
        0,
    )?;

    // Mutable borrow of session only after queue_computation releases ctx.accounts.
    ctx.accounts.session.arcium_task_id = computation_offset;
    ctx.accounts.session.state = SessionState::Computing;
    Ok(())
}
