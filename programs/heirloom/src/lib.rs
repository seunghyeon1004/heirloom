//! Heirloom: a dead-man's-switch inheritance vault.
//!
//! The owner locks SOL in a PDA and names heirs with basis-point shares.
//! Every owner-signed action (or a heartbeat from a delegated key) resets a
//! timer. When `last_heartbeat + interval + grace` passes (and no guardian
//! pause is active), each heir can claim their share exactly once.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2GvFQtnM7cGaM9wso5iw6nMH5abo2aYKJRneZiWbQbKv");

#[program]
pub mod heirloom {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        heirs: Vec<Heir>,
        checkin_interval_secs: i64,
        grace_period_secs: i64,
        guardian: Option<Pubkey>,
        heartbeat_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(
            ctx,
            heirs,
            checkin_interval_secs,
            grace_period_secs,
            guardian,
            heartbeat_authority,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn heartbeat(ctx: Context<CheckIn>) -> Result<()> {
        instructions::heartbeat::handle_heartbeat(ctx)
    }

    pub fn withdraw(ctx: Context<OwnerAction>, amount: u64) -> Result<()> {
        instructions::owner_actions::handle_withdraw(ctx, amount)
    }

    pub fn update_config(
        ctx: Context<OwnerAction>,
        heirs: Option<Vec<Heir>>,
        checkin_interval_secs: Option<i64>,
        grace_period_secs: Option<i64>,
        guardian: Option<Option<Pubkey>>,
        heartbeat_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::owner_actions::handle_update_config(
            ctx,
            heirs,
            checkin_interval_secs,
            grace_period_secs,
            guardian,
            heartbeat_authority,
        )
    }

    pub fn set_guide_hash(ctx: Context<OwnerAction>, guide_hash: [u8; 32]) -> Result<()> {
        instructions::owner_actions::handle_set_guide_hash(ctx, guide_hash)
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        instructions::owner_actions::handle_cancel(ctx)
    }

    pub fn guardian_pause(ctx: Context<GuardianPause>, pause_secs: i64) -> Result<()> {
        instructions::guardian_pause::handle_guardian_pause(ctx, pause_secs)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handle_claim(ctx)
    }
}
