use anchor_lang::prelude::*;

use crate::{Session, SessionState, SESSION_SPACE};

#[derive(Accounts)]
#[instruction(session_id: [u8; 8])]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = SESSION_SPACE,
        seeds = [b"session", &session_id],
        bump
    )]
    pub session: Account<'info, Session>,
    pub system_program: Program<'info, System>,
}

pub fn create_session(
    ctx: Context<CreateSession>,
    _session_id: [u8; 8],
    commitment_a: [u8; 32],
    asset_mask: u8,
    expires_at: i64,
) -> Result<()> {
    let session = &mut ctx.accounts.session;
    session.wallet_a = ctx.accounts.signer.key();
    session.wallet_b = Pubkey::default();
    session.commitment_a = commitment_a;
    session.commitment_b = [0; 32];
    session.arcium_task_id = 0;
    session.state = SessionState::AwaitingCounterparty;
    session.asset_mask = asset_mask;
    session.created_at = Clock::get()?.unix_timestamp;
    session.expires_at = expires_at;
    session.bump = ctx.bumps.session;
    session.state_nonce = 0;
    session.intersection = Vec::new();
    Ok(())
}
