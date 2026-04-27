use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::{
    SilentCircleError, Session, SessionState, COMP_DEF_OFFSET_COMPUTE_PSI, ComputePsiCallback,
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
    pub mxe_account: Account<'info, MXEAccount>,
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
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, SilentCircleError::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
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
    // Wallet A's encrypted asset fingerprints (Enc<Shared, SetA>)
    set_a_items: [[u8; 32]; 4], // 4 encrypted u64 ciphertexts
    set_a_count: [u8; 32],      // encrypted u8 ciphertext
    set_a_pubkey: [u8; 32],     // X25519 public key used for Enc<Shared>
    set_a_nonce: u128,          // nonce
    // Wallet B's encrypted asset fingerprints (Enc<Shared, SetB>)
    set_b_items: [[u8; 32]; 4],
    set_b_count: [u8; 32],
    set_b_pubkey: [u8; 32],
    set_b_nonce: u128,
) -> Result<()> {
    let s = &mut ctx.accounts.session;
    require!(
        s.state == SessionState::BothCommitted,
        SilentCircleError::InvalidState
    );
    require!(
        Clock::get()?.unix_timestamp <= s.expires_at,
        SilentCircleError::SessionExpired
    );

    let signer = ctx.accounts.signer.key();
    require!(
        signer == s.wallet_a || signer == s.wallet_b,
        SilentCircleError::UnauthorizedStart
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Build the ArgumentList for the Arcium MXE:
    //   Enc<Shared, SetA>  →  x25519_pubkey + nonce + 4×encrypted_u64 + encrypted_u8
    //   Enc<Shared, SetB>  →  same layout
    let args = ArgBuilder::new()
        // — Wallet A's set —
        .x25519_pubkey(set_a_pubkey)
        .plaintext_u128(set_a_nonce)
        .encrypted_u64(set_a_items[0])
        .encrypted_u64(set_a_items[1])
        .encrypted_u64(set_a_items[2])
        .encrypted_u64(set_a_items[3])
        .encrypted_u8(set_a_count)
        // — Wallet B's set —
        .x25519_pubkey(set_b_pubkey)
        .plaintext_u128(set_b_nonce)
        .encrypted_u64(set_b_items[0])
        .encrypted_u64(set_b_items[1])
        .encrypted_u64(set_b_items[2])
        .encrypted_u64(set_b_items[3])
        .encrypted_u8(set_b_count)
        .build();

    // Queue the PSI computation on the Arcium network.
    // The MXE will decrypt both sets in the garbled circuit, compute the
    // intersection, and invoke `write_intersection` as the success callback.
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![ComputePsiCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.session.key(),
                is_writable: true,
            }],
        )?],
        1, // num_signers
        0, // extra_compute_budget
    )?;

    s.arcium_task_id = computation_offset;
    s.state = SessionState::Computing;
    Ok(())
}
