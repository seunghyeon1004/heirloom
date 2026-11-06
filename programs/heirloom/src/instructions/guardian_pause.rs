use anchor_lang::prelude::*;

use crate::{constants::*, error::HeirloomError, state::*};

#[derive(Accounts)]
pub struct GuardianPause<'info> {
    pub guardian: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        constraint = vault.guardian == Some(guardian.key()) @ HeirloomError::NotGuardian,
        constraint = vault.status == VaultStatus::Active @ HeirloomError::VaultNotActive,
    )]
    pub vault: Account<'info, Vault>,
}

/// The guardian vouches (off-chain) that the owner is alive but unreachable,
/// pushing the unlock time out. Bounded in length and count; cannot move funds.
pub fn handle_guardian_pause(ctx: Context<GuardianPause>, pause_secs: i64) -> Result<()> {
    require!(
        pause_secs > 0 && pause_secs <= MAX_PAUSE_SECS,
        HeirloomError::InvalidPause
    );
    let vault = &mut ctx.accounts.vault;
    require!(vault.pauses_used < MAX_PAUSES, HeirloomError::TooManyPauses);
    let now = Clock::get()?.unix_timestamp;
    let until = now.checked_add(pause_secs).ok_or(HeirloomError::Overflow)?;
    vault.paused_until = vault.paused_until.max(until);
    vault.pauses_used += 1;
    emit!(GuardianPaused {
        vault: vault.key(),
        paused_until: vault.paused_until,
        pauses_used: vault.pauses_used,
    });
    Ok(())
}
