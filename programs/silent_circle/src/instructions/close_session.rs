use anchor_lang::prelude::*;

use crate::{SilentCircleError, Session, SessionState};

/// Reclaims the rent locked in the session PDA back to wallet A.
///
/// Allowed once `expires_at` has passed, OR once the session is in a terminal
/// state (`Done` / `Expired`). The signer must be wallet A (the initiator),
/// since they paid for the account in `create_session`.
#[derive(Accounts)]
pub struct CloseSession<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        close = signer,
        has_one = wallet_a @ SilentCircleError::UnauthorizedClose,
    )]
    pub session: Account<'info, Session>,
    /// CHECK: matched against `session.wallet_a` via the `has_one` constraint.
    pub wallet_a: UncheckedAccount<'info>,
}

pub fn close_session(ctx: Context<CloseSession>) -> Result<()> {
    let s = &ctx.accounts.session;
    let now = Clock::get()?.unix_timestamp;

    let is_expired = now > s.expires_at;
    let is_terminal = matches!(s.state, SessionState::Done | SessionState::Expired);

    require!(is_expired || is_terminal, SilentCircleError::SessionStillActive);
    Ok(())
}
