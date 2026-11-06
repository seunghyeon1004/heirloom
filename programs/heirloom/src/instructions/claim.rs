use anchor_lang::prelude::*;

use crate::{constants::*, error::HeirloomError, state::*};

#[derive(Accounts)]
pub struct Claim<'info> {
    /// The heir claiming their share; also the recipient.
    #[account(mut)]
    pub heir: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    let heir_key = ctx.accounts.heir.key();
    let vault_info = ctx.accounts.vault.to_account_info();
    let available = withdrawable(&vault_info)?;
    let now = Clock::get()?.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    require!(vault.status != VaultStatus::Settled, HeirloomError::VaultSettled);
    let idx = vault.heir_index(&heir_key).ok_or(HeirloomError::NotHeir)?;
    let bit = 1u8 << idx;
    require!(vault.claimed_bitmap & bit == 0, HeirloomError::AlreadyClaimed);
    require!(now >= vault.unlock_at()?, HeirloomError::StillLocked);

    if vault.status == VaultStatus::Active {
        // First claim freezes the pot so every heir's share is computed on the same base.
        vault.status = VaultStatus::Claiming;
        vault.claim_snapshot = available;
    }

    // Effects before interactions: mark claimed first.
    vault.claimed_bitmap |= bit;
    let settled = vault.all_claimed();
    let amount = if settled {
        // Last heir sweeps everything above rent (rounding dust and any stray transfers).
        available
    } else {
        let share = (vault.claim_snapshot as u128)
            .checked_mul(vault.heirs[idx].share_bps as u128)
            .ok_or(HeirloomError::Overflow)?
            / TOTAL_BPS as u128;
        u64::try_from(share).map_err(|_| HeirloomError::Overflow)?.min(available)
    };
    vault.claimed_total = vault
        .claimed_total
        .checked_add(amount)
        .ok_or(HeirloomError::Overflow)?;
    if settled {
        vault.status = VaultStatus::Settled;
    }

    if amount > 0 {
        ctx.accounts.vault.sub_lamports(amount)?;
        ctx.accounts.heir.add_lamports(amount)?;
    }
    emit!(Claimed { vault: ctx.accounts.vault.key(), heir: heir_key, amount, settled });
    Ok(())
}
