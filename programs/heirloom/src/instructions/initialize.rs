use anchor_lang::prelude::*;

use crate::{constants::*, state::*};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    heirs: Vec<Heir>,
    checkin_interval_secs: i64,
    grace_period_secs: i64,
    guardian: Option<Pubkey>,
    heartbeat_authority: Option<Pubkey>,
) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    validate_heirs(&heirs, &owner)?;
    validate_timing(checkin_interval_secs, grace_period_secs)?;
    let now = Clock::get()?.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    vault.owner = owner;
    vault.heartbeat_authority = heartbeat_authority.unwrap_or(owner);
    vault.guardian = guardian;
    vault.heirs = heirs;
    vault.checkin_interval_secs = checkin_interval_secs;
    vault.grace_period_secs = grace_period_secs;
    vault.last_heartbeat = now;
    vault.created_at = now;
    vault.paused_until = 0;
    vault.pauses_used = 0;
    vault.status = VaultStatus::Active;
    vault.claimed_bitmap = 0;
    vault.claim_snapshot = 0;
    vault.claimed_total = 0;
    vault.guide_hash = [0u8; 32];
    vault.bump = ctx.bumps.vault;

    emit!(VaultCreated {
        vault: vault.key(),
        owner,
        heirs: vault.heirs.len() as u8,
        checkin_interval_secs,
        grace_period_secs,
    });
    Ok(())
}
