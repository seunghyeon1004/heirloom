use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Maximum number of heirs per vault (also bounds the claimed bitmap, a u8).
#[constant]
pub const MAX_HEIRS: u8 = 5;

/// Basis points that heir shares must add up to (100%).
#[constant]
pub const TOTAL_BPS: u16 = 10_000;

/// Shortest allowed check-in interval. 60 s keeps live demos possible on devnet.
/// A production deployment would raise this (e.g. 7 days).
#[constant]
pub const MIN_INTERVAL_SECS: i64 = 60;

/// Longest allowed check-in interval: ~10 years.
#[constant]
pub const MAX_INTERVAL_SECS: i64 = 10 * 365 * 24 * 60 * 60;

/// Longest allowed grace period after a missed check-in: 1 year.
#[constant]
pub const MAX_GRACE_SECS: i64 = 365 * 24 * 60 * 60;

/// A guardian pause can push the unlock time at most 30 days into the future.
#[constant]
pub const MAX_PAUSE_SECS: i64 = 30 * 24 * 60 * 60;

/// A guardian can pause at most this many times between two owner heartbeats,
/// so a hostile guardian can delay heirs by at most ~90 days, never forever.
#[constant]
pub const MAX_PAUSES: u8 = 3;
