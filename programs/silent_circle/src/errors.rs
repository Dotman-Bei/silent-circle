use anchor_lang::prelude::*;

#[error_code]
pub enum SilentCircleError {
    #[msg("The session is not in a valid state for this instruction.")]
    InvalidState,
    #[msg("A counterparty has already joined this session.")]
    AlreadyJoined,
    #[msg("Only a participating wallet can start the PSI task.")]
    UnauthorizedStart,
    #[msg("Only the Arcium program callback may write the intersection.")]
    UnauthorizedCallback,
    #[msg("This session has expired.")]
    SessionExpired,
    #[msg("Arcium cluster not configured for this MXE account.")]
    ClusterNotSet,
}
