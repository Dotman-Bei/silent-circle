use anchor_lang::prelude::*;

use crate::{SilentCircleError, Session, SessionState};

#[derive(Accounts)]
pub struct CommitSet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub session: Account<'info, Session>,
}

pub fn commit_set(ctx: Context<CommitSet>, commitment_b: [u8; 32]) -> Result<()> {
    let session = &mut ctx.accounts.session;
    require!(session.state == SessionState::AwaitingCounterparty, SilentCircleError::InvalidState);
    require!(session.wallet_b == Pubkey::default(), SilentCircleError::AlreadyJoined);
    require!(Clock::get()?.unix_timestamp <= session.expires_at, SilentCircleError::SessionExpired);

    session.wallet_b = ctx.accounts.signer.key();
    session.commitment_b = commitment_b;
    session.state = SessionState::BothCommitted;
    Ok(())
}
