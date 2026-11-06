use anchor_lang::prelude::*;

use crate::{constants::*, error::HeirloomError, instructions::deposit::touch, state::*};

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
        constraint = vault.status == VaultStatus::Active @ HeirloomError::VaultNotActive,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_withdraw(ctx: Context<OwnerAction>, amount: u64) -> Result<()> {
    require!(amount > 0, HeirloomError::ZeroAmount);
    let available = withdrawable(&ctx.accounts.vault.to_account_info())?;
    require!(amount <= available, HeirloomError::InsufficientFunds);
    ctx.accounts.vault.sub_lamports(amount)?;
    ctx.accounts.owner.add_lamports(amount)?;
    let now = Clock::get()?.unix_timestamp;
    touch(&mut ctx.accounts.vault, now);
    emit!(Withdrawn { vault: ctx.accounts.vault.key(), amount });
    Ok(())
}

pub fn handle_update_config(
    ctx: Context<OwnerAction>,
    heirs: Option<Vec<Heir>>,
    checkin_interval_secs: Option<i64>,
    grace_period_secs: Option<i64>,
    guardian: Option<Option<Pubkey>>,
    heartbeat_authority: Option<Pubkey>,
) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    let vault = &mut ctx.accounts.vault;
    if let Some(h) = heirs {
        validate_heirs(&h, &owner)?;
        vault.heirs = h;
    }
    let interval = checkin_interval_secs.unwrap_or(vault.checkin_interval_secs);
    let grace = grace_period_secs.unwrap_or(vault.grace_period_secs);
    validate_timing(interval, grace)?;
    vault.checkin_interval_secs = interval;
    vault.grace_period_secs = grace;
    if let Some(g) = guardian {
        vault.guardian = g;
    }
    if let Some(a) = heartbeat_authority {
        vault.heartbeat_authority = a;
    }
    let now = Clock::get()?.unix_timestamp;
    touch(vault, now);
    emit!(ConfigUpdated { vault: vault.key() });
    Ok(())
}

pub fn handle_set_guide_hash(ctx: Context<OwnerAction>, guide_hash: [u8; 32]) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.guide_hash = guide_hash;
    let now = Clock::get()?.unix_timestamp;
    touch(vault, now);
    emit!(GuideHashSet { vault: vault.key(), guide_hash });
    Ok(())
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
        constraint = vault.status == VaultStatus::Active @ HeirloomError::VaultNotActive,
        close = owner,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_cancel(ctx: Context<Cancel>) -> Result<()> {
    emit!(VaultCancelled {
        vault: ctx.accounts.vault.key(),
        returned: ctx.accounts.vault.to_account_info().lamports(),
    });
    Ok(())
}
