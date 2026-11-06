use anchor_lang::prelude::*;

use crate::{constants::*, error::HeirloomError};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Heir {
    pub key: Pubkey,
    pub share_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum VaultStatus {
    /// Owner is in control. Funds can be deposited and withdrawn.
    Active,
    /// At least one heir has claimed. Owner and guardian powers are gone.
    Claiming,
    /// Every heir has claimed.
    Settled,
}

/// One inheritance vault per owner. Holds native SOL as lamports above its
/// rent-exempt minimum. PDA seeds: ["vault", owner].
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub owner: Pubkey,
    /// Key allowed to call `heartbeat` only (defaults to the owner).
    pub heartbeat_authority: Pubkey,
    /// Optional key that may delay the unlock (bounded), never move funds.
    pub guardian: Option<Pubkey>,
    #[max_len(5)]
    pub heirs: Vec<Heir>,
    pub checkin_interval_secs: i64,
    pub grace_period_secs: i64,
    pub last_heartbeat: i64,
    pub created_at: i64,
    pub paused_until: i64,
    pub pauses_used: u8,
    pub status: VaultStatus,
    /// Bit i set = heirs[i] has claimed.
    pub claimed_bitmap: u8,
    /// Withdrawable balance frozen at the first claim; shares are computed on it.
    pub claim_snapshot: u64,
    pub claimed_total: u64,
    /// SHA-256 of the off-chain handoff guide (all zero = none).
    pub guide_hash: [u8; 32],
    pub bump: u8,
}

impl Vault {
    /// Earliest unix time at which heirs may claim.
    pub fn unlock_at(&self) -> Result<i64> {
        let by_timer = self
            .last_heartbeat
            .checked_add(self.checkin_interval_secs)
            .and_then(|t| t.checked_add(self.grace_period_secs))
            .ok_or(HeirloomError::Overflow)?;
        Ok(by_timer.max(self.paused_until))
    }

    pub fn heir_index(&self, key: &Pubkey) -> Option<usize> {
        self.heirs.iter().position(|h| h.key == *key)
    }

    pub fn all_claimed(&self) -> bool {
        let full: u8 = if self.heirs.len() >= 8 { u8::MAX } else { (1u8 << self.heirs.len()) - 1 };
        self.claimed_bitmap & full == full
    }
}

pub fn validate_heirs(heirs: &[Heir], owner: &Pubkey) -> Result<()> {
    require!(
        !heirs.is_empty() && heirs.len() <= MAX_HEIRS as usize,
        HeirloomError::InvalidHeirCount
    );
    let mut sum: u32 = 0;
    for (i, h) in heirs.iter().enumerate() {
        require!(h.share_bps > 0, HeirloomError::ZeroShare);
        require!(
            h.key != Pubkey::default() && h.key != *owner,
            HeirloomError::InvalidHeir
        );
        require!(
            !heirs[..i].iter().any(|o| o.key == h.key),
            HeirloomError::DuplicateHeir
        );
        sum = sum.checked_add(h.share_bps as u32).ok_or(HeirloomError::Overflow)?;
    }
    require!(sum == TOTAL_BPS as u32, HeirloomError::SharesNotFull);
    Ok(())
}

pub fn validate_timing(interval: i64, grace: i64) -> Result<()> {
    require!(
        (MIN_INTERVAL_SECS..=MAX_INTERVAL_SECS).contains(&interval),
        HeirloomError::InvalidInterval
    );
    require!((0..=MAX_GRACE_SECS).contains(&grace), HeirloomError::InvalidGrace);
    Ok(())
}

/// Lamports above the rent-exempt minimum.
pub fn withdrawable(info: &AccountInfo) -> Result<u64> {
    let min = Rent::get()?.minimum_balance(info.data_len());
    Ok(info.lamports().saturating_sub(min))
}

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub heirs: u8,
    pub checkin_interval_secs: i64,
    pub grace_period_secs: i64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Heartbeat {
    pub vault: Pubkey,
    pub signer: Pubkey,
    pub at: i64,
}

#[event]
pub struct ConfigUpdated {
    pub vault: Pubkey,
}

#[event]
pub struct GuideHashSet {
    pub vault: Pubkey,
    pub guide_hash: [u8; 32],
}

#[event]
pub struct GuardianPaused {
    pub vault: Pubkey,
    pub paused_until: i64,
    pub pauses_used: u8,
}

#[event]
pub struct Claimed {
    pub vault: Pubkey,
    pub heir: Pubkey,
    pub amount: u64,
    pub settled: bool,
}

#[event]
pub struct VaultCancelled {
    pub vault: Pubkey,
    pub returned: u64,
}
