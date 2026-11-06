use anchor_lang::prelude::*;

use crate::{constants::*, error::HeirloomError, instructions::deposit::touch, state::*};

#[derive(Accounts)]
pub struct CheckIn<'info> {
    /// Owner or the delegated heartbeat authority.
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_heartbeat(ctx: Context<CheckIn>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let signer = ctx.accounts.signer.key();
    require!(
        signer == vault.owner || signer == vault.heartbeat_authority,
        HeirloomError::NotHeartbeatAuthority
    );
    require!(vault.status == VaultStatus::Active, HeirloomError::VaultNotActive);
    let now = Clock::get()?.unix_timestamp;
    touch(vault, now);
    emit!(Heartbeat { vault: vault.key(), signer, at: now });
    Ok(())
}
