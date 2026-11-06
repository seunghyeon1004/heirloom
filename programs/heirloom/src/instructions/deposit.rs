use anchor_lang::prelude::*;

use crate::{constants::*, error::HeirloomError, state::*};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, HeirloomError::ZeroAmount);
    require!(
        ctx.accounts.vault.status == VaultStatus::Active,
        HeirloomError::VaultNotActive
    );
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.owner.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new(anchor_lang::system_program::ID, cpi_accounts),
        amount,
    )?;
    // A signed owner transaction is proof of life.
    let now = Clock::get()?.unix_timestamp;
    touch(&mut ctx.accounts.vault, now);
    emit!(Deposited { vault: ctx.accounts.vault.key(), amount });
    Ok(())
}

/// Record owner liveness: reset the timer and clear any guardian pause.
pub fn touch(vault: &mut Vault, now: i64) {
    vault.last_heartbeat = now;
    vault.paused_until = 0;
    vault.pauses_used = 0;
}
