use anchor_lang::prelude::*;

#[error_code]
pub enum HeirloomError {
    #[msg("A vault needs between 1 and 5 heirs")]
    InvalidHeirCount,
    #[msg("Every heir needs a share above zero")]
    ZeroShare,
    #[msg("Heir shares must add up to exactly 10000 basis points")]
    SharesNotFull,
    #[msg("The same heir is listed twice")]
    DuplicateHeir,
    #[msg("The owner cannot be their own heir, and heirs cannot be the default key")]
    InvalidHeir,
    #[msg("Check-in interval is out of range")]
    InvalidInterval,
    #[msg("Grace period is out of range")]
    InvalidGrace,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Not enough withdrawable balance in the vault")]
    InsufficientFunds,
    #[msg("Vault is no longer active: heirs have started claiming")]
    VaultNotActive,
    #[msg("Vault is fully settled")]
    VaultSettled,
    #[msg("Signer is not allowed to check in for this vault")]
    NotHeartbeatAuthority,
    #[msg("Signer is not the guardian of this vault")]
    NotGuardian,
    #[msg("Pause length is out of range")]
    InvalidPause,
    #[msg("Guardian has used all pauses for this check-in period")]
    TooManyPauses,
    #[msg("Signer is not an heir of this vault")]
    NotHeir,
    #[msg("The vault is still locked: the owner checked in recently")]
    StillLocked,
    #[msg("This heir has already claimed")]
    AlreadyClaimed,
    #[msg("Arithmetic overflow")]
    Overflow,
}
