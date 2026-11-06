//! LiteSVM tests for every Heirloom instruction, including the attack paths.
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    heirloom::{state::Heir, Vault, VaultStatus, VAULT_SEED},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SOL: u64 = 1_000_000_000;
const INTERVAL: i64 = 90;
const GRACE: i64 = 30;

struct Env {
    svm: LiteSVM,
    owner: Keypair,
    heir_a: Keypair,
    heir_b: Keypair,
    guardian: Keypair,
    relay: Keypair,
    stranger: Keypair,
}

fn pid() -> Pubkey {
    heirloom::id()
}

fn vault_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, owner.as_ref()], &pid()).0
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/heirloom.so"));
        svm.add_program(pid(), bytes).unwrap();
        let env = Env {
            svm,
            owner: Keypair::new(),
            heir_a: Keypair::new(),
            heir_b: Keypair::new(),
            guardian: Keypair::new(),
            relay: Keypair::new(),
            stranger: Keypair::new(),
        };
        let mut env = env;
        for k in [
            env.owner.pubkey(),
            env.heir_a.pubkey(),
            env.heir_b.pubkey(),
            env.guardian.pubkey(),
            env.relay.pubkey(),
            env.stranger.pubkey(),
        ] {
            env.svm.airdrop(&k, 10 * SOL).unwrap();
        }
        env.set_time(1_700_000_000);
        env
    }

    fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    fn set_time(&mut self, t: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp = t;
        self.svm.set_sysvar(&c);
    }

    fn advance(&mut self, secs: i64) {
        let t = self.now() + secs;
        self.set_time(t);
    }

    fn send(&mut self, ix: Instruction, signer: &Keypair) -> Result<(), String> {
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?} {}", e.err, e.meta.logs.join("\n")))
    }

    fn vault(&self) -> Vault {
        let acc = self.svm.get_account(&vault_pda(&self.owner.pubkey())).unwrap();
        Vault::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn lamports(&self, k: &Pubkey) -> u64 {
        self.svm.get_account(k).map(|a| a.lamports).unwrap_or(0)
    }

    fn heirs(&self, a: u16, b: u16) -> Vec<Heir> {
        vec![
            Heir { key: self.heir_a.pubkey(), share_bps: a },
            Heir { key: self.heir_b.pubkey(), share_bps: b },
        ]
    }

    fn init_ix(&self, heirs: Vec<Heir>, interval: i64, grace: i64) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::Initialize {
                heirs,
                checkin_interval_secs: interval,
                grace_period_secs: grace,
                guardian: Some(self.guardian.pubkey()),
                heartbeat_authority: Some(self.relay.pubkey()),
            }
            .data(),
            heirloom::accounts::Initialize {
                owner: self.owner.pubkey(),
                vault: vault_pda(&self.owner.pubkey()),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn deposit_ix(&self, owner: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::Deposit { amount }.data(),
            heirloom::accounts::Deposit {
                owner: *owner,
                vault: vault_pda(owner),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn owner_metas(&self, signer: &Pubkey, vault: Pubkey) -> Vec<anchor_lang::prelude::AccountMeta> {
        heirloom::accounts::OwnerAction { owner: *signer, vault }.to_account_metas(None)
    }

    fn withdraw_ix(&self, signer: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::Withdraw { amount }.data(),
            self.owner_metas(signer, vault_pda(&self.owner.pubkey())),
        )
    }

    fn heartbeat_ix(&self, signer: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::Heartbeat {}.data(),
            heirloom::accounts::CheckIn { signer: *signer, vault: vault_pda(&self.owner.pubkey()) }
                .to_account_metas(None),
        )
    }

    fn claim_ix(&self, heir: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::Claim {}.data(),
            heirloom::accounts::Claim { heir: *heir, vault: vault_pda(&self.owner.pubkey()) }
                .to_account_metas(None),
        )
    }

    fn pause_ix(&self, signer: &Pubkey, secs: i64) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::GuardianPause { pause_secs: secs }.data(),
            heirloom::accounts::GuardianPause { guardian: *signer, vault: vault_pda(&self.owner.pubkey()) }
                .to_account_metas(None),
        )
    }

    fn cancel_ix(&self, signer: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::Cancel {}.data(),
            heirloom::accounts::Cancel { owner: *signer, vault: vault_pda(&self.owner.pubkey()) }
                .to_account_metas(None),
        )
    }

    fn update_ix(&self, signer: &Pubkey, heirs: Option<Vec<Heir>>, interval: Option<i64>) -> Instruction {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::UpdateConfig {
                heirs,
                checkin_interval_secs: interval,
                grace_period_secs: None,
                guardian: None,
                heartbeat_authority: None,
            }
            .data(),
            self.owner_metas(signer, vault_pda(&self.owner.pubkey())),
        )
    }

    /// Standard setup: 60/40 vault funded with `amount`.
    fn funded(amount: u64) -> Self {
        let mut env = Env::new();
        let ix = env.init_ix(env.heirs(6_000, 4_000), INTERVAL, GRACE);
        let owner = env.owner.insecure_clone();
        env.send(ix, &owner).unwrap();
        let ix = env.deposit_ix(&owner.pubkey(), amount);
        env.send(ix, &owner).unwrap();
        env
    }

    fn rent_min(&self) -> u64 {
        let acc = self.svm.get_account(&vault_pda(&self.owner.pubkey())).unwrap();
        self.svm.minimum_balance_for_rent_exemption(acc.data.len())
    }
}

fn expect_err(r: Result<(), String>, needle: &str) {
    match r {
        Ok(()) => panic!("expected failure containing {needle}, got success"),
        Err(e) => assert!(e.contains(needle), "expected `{needle}` in error, got:\n{e}"),
    }
}

// ---------- initialize ----------

#[test]
fn initialize_stores_config() {
    let env = Env::funded(SOL);
    let v = env.vault();
    assert_eq!(v.owner, env.owner.pubkey());
    assert_eq!(v.heartbeat_authority, env.relay.pubkey());
    assert_eq!(v.guardian, Some(env.guardian.pubkey()));
    assert_eq!(v.heirs.len(), 2);
    assert_eq!(v.checkin_interval_secs, INTERVAL);
    assert_eq!(v.grace_period_secs, GRACE);
    assert_eq!(v.status, VaultStatus::Active);
    assert_eq!(v.last_heartbeat, env.now());
    assert_eq!(env.lamports(&vault_pda(&env.owner.pubkey())), env.rent_min() + SOL);
}

#[test]
fn initialize_rejects_bad_heirs_and_timing() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let cases: Vec<(Vec<Heir>, i64, i64, &str)> = vec![
        (env.heirs(6_000, 3_999), INTERVAL, GRACE, "SharesNotFull"),
        (env.heirs(6_000, 4_001), INTERVAL, GRACE, "SharesNotFull"),
        (env.heirs(10_000, 0), INTERVAL, GRACE, "ZeroShare"),
        (vec![], INTERVAL, GRACE, "InvalidHeirCount"),
        (
            vec![
                Heir { key: env.heir_a.pubkey(), share_bps: 5_000 },
                Heir { key: env.heir_a.pubkey(), share_bps: 5_000 },
            ],
            INTERVAL,
            GRACE,
            "DuplicateHeir",
        ),
        (
            vec![Heir { key: owner.pubkey(), share_bps: 10_000 }],
            INTERVAL,
            GRACE,
            "InvalidHeir",
        ),
        (
            (0..6).map(|_| Heir { key: Pubkey::new_unique(), share_bps: 1_000 }).collect(),
            INTERVAL,
            GRACE,
            "InvalidHeirCount",
        ),
        (env.heirs(6_000, 4_000), 59, GRACE, "InvalidInterval"),
        (env.heirs(6_000, 4_000), INTERVAL, -1, "InvalidGrace"),
        (env.heirs(6_000, 4_000), i64::MAX, GRACE, "InvalidInterval"),
    ];
    for (heirs, interval, grace, needle) in cases {
        let ix = env.init_ix(heirs, interval, grace);
        expect_err(env.send(ix, &owner), needle);
    }
    // And a valid one still works afterwards (nothing was created by the failures).
    let ix = env.init_ix(env.heirs(5_000, 5_000), 60, 0);
    env.send(ix, &owner).unwrap();
    // Re-initializing the same vault fails.
    let ix = env.init_ix(env.heirs(5_000, 5_000), 60, 0);
    expect_err(env.send(ix, &owner), "already in use");
}

// ---------- deposit / withdraw ----------

#[test]
fn owner_can_withdraw_but_not_below_rent() {
    let mut env = Env::funded(2 * SOL);
    let owner = env.owner.insecure_clone();
    let before = env.lamports(&owner.pubkey());
    let ix = env.withdraw_ix(&owner.pubkey(), SOL);
    env.send(ix, &owner).unwrap();
    assert_eq!(env.lamports(&owner.pubkey()), before + SOL - 5_000);
    // Withdrawing more than what sits above rent fails.
    let ix = env.withdraw_ix(&owner.pubkey(), SOL + 1);
    expect_err(env.send(ix, &owner), "InsufficientFunds");
    let ix = env.withdraw_ix(&owner.pubkey(), 0);
    expect_err(env.send(ix, &owner), "ZeroAmount");
    let ix = env.withdraw_ix(&owner.pubkey(), SOL);
    env.send(ix, &owner).unwrap();
    assert_eq!(env.lamports(&vault_pda(&owner.pubkey())), env.rent_min());
}

#[test]
fn non_owners_cannot_withdraw() {
    let mut env = Env::funded(SOL);
    for k in [
        env.heir_a.insecure_clone(),
        env.guardian.insecure_clone(),
        env.relay.insecure_clone(),
        env.stranger.insecure_clone(),
    ] {
        // Pointing at the owner's vault with another signer: PDA seeds / has_one reject it.
        let ix = env.withdraw_ix(&k.pubkey(), 1);
        expect_err(env.send(ix, &k), "ConstraintSeeds");
    }
    // Stranger cannot deposit into someone else's vault either (seeds bound to signer).
    let s = env.stranger.insecure_clone();
    let mut ix = env.deposit_ix(&s.pubkey(), 1);
    ix.accounts[1].pubkey = vault_pda(&env.owner.pubkey());
    expect_err(env.send(ix, &s), "ConstraintSeeds");
}

// ---------- heartbeat ----------

#[test]
fn heartbeat_by_owner_or_relay_only() {
    let mut env = Env::funded(SOL);
    let owner = env.owner.insecure_clone();
    let relay = env.relay.insecure_clone();
    env.advance(50);
    let ix = env.heartbeat_ix(&owner.pubkey());
    env.send(ix, &owner).unwrap();
    assert_eq!(env.vault().last_heartbeat, env.now());
    env.advance(50);
    let ix = env.heartbeat_ix(&relay.pubkey());
    env.send(ix, &relay).unwrap();
    assert_eq!(env.vault().last_heartbeat, env.now());
    for k in [env.heir_a.insecure_clone(), env.guardian.insecure_clone(), env.stranger.insecure_clone()] {
        let ix = env.heartbeat_ix(&k.pubkey());
        expect_err(env.send(ix, &k), "NotHeartbeatAuthority");
    }
}

#[test]
fn relay_key_cannot_move_funds_or_change_config() {
    let mut env = Env::funded(SOL);
    let relay = env.relay.insecure_clone();
    let ix = env.withdraw_ix(&relay.pubkey(), 1);
    expect_err(env.send(ix, &relay), "ConstraintSeeds");
    let ix = env.update_ix(&relay.pubkey(), None, Some(600));
    expect_err(env.send(ix, &relay), "ConstraintSeeds");
    let ix = env.cancel_ix(&relay.pubkey());
    expect_err(env.send(ix, &relay), "ConstraintSeeds");
}

// ---------- claim ----------

#[test]
fn claim_respects_exact_unlock_boundary() {
    let mut env = Env::funded(SOL);
    let a = env.heir_a.insecure_clone();
    let start = env.vault().last_heartbeat;
    env.set_time(start + INTERVAL + GRACE - 1);
    let ix = env.claim_ix(&a.pubkey());
    expect_err(env.send(ix, &a), "StillLocked");
    env.set_time(start + INTERVAL + GRACE);
    let ix = env.claim_ix(&a.pubkey());
    env.send(ix, &a).unwrap();
}

#[test]
fn heirs_split_by_shares_once_each() {
    let mut env = Env::funded(SOL + 7); // odd amount to force rounding dust
    let a = env.heir_a.insecure_clone();
    let b = env.heir_b.insecure_clone();
    let s = env.stranger.insecure_clone();
    env.advance(INTERVAL + GRACE);
    let (a0, b0) = (env.lamports(&a.pubkey()), env.lamports(&b.pubkey()));

    let ix = env.claim_ix(&s.pubkey());
    expect_err(env.send(ix, &s), "NotHeir");

    let ix = env.claim_ix(&a.pubkey());
    env.send(ix, &a).unwrap();
    let pot = SOL + 7;
    let a_share = pot * 6_000 / 10_000;
    assert_eq!(env.lamports(&a.pubkey()), a0 + a_share - 5_000);
    let v = env.vault();
    assert_eq!(v.status, VaultStatus::Claiming);
    assert_eq!(v.claim_snapshot, pot);

    let ix = env.claim_ix(&a.pubkey());
    expect_err(env.send(ix, &a), "AlreadyClaimed");

    let ix = env.claim_ix(&b.pubkey());
    env.send(ix, &b).unwrap();
    // Last heir sweeps the remainder, including rounding dust.
    assert_eq!(env.lamports(&b.pubkey()), b0 + (pot - a_share) - 5_000);
    let v = env.vault();
    assert_eq!(v.status, VaultStatus::Settled);
    assert_eq!(v.claimed_total, pot);
    // Vault keeps exactly its rent-exempt minimum; nothing is stuck or over-paid.
    assert_eq!(env.lamports(&vault_pda(&env.owner.pubkey())), env.rent_min());

    let ix = env.claim_ix(&b.pubkey());
    expect_err(env.send(ix, &b), "VaultSettled");
}

#[test]
fn owner_and_guardian_lose_powers_once_claiming_starts() {
    let mut env = Env::funded(SOL);
    let owner = env.owner.insecure_clone();
    let g = env.guardian.insecure_clone();
    let a = env.heir_a.insecure_clone();
    env.advance(INTERVAL + GRACE + 1);
    let ix = env.claim_ix(&a.pubkey());
    env.send(ix, &a).unwrap();

    let ix = env.withdraw_ix(&owner.pubkey(), 1);
    expect_err(env.send(ix, &owner), "VaultNotActive");
    let ix = env.heartbeat_ix(&owner.pubkey());
    expect_err(env.send(ix, &owner), "VaultNotActive");
    let ix = env.cancel_ix(&owner.pubkey());
    expect_err(env.send(ix, &owner), "VaultNotActive");
    let ix = env.update_ix(&owner.pubkey(), None, Some(600));
    expect_err(env.send(ix, &owner), "VaultNotActive");
    let ix = env.pause_ix(&g.pubkey(), 3600);
    expect_err(env.send(ix, &g), "VaultNotActive");
    let ix = env.deposit_ix(&owner.pubkey(), 1);
    expect_err(env.send(ix, &owner), "VaultNotActive");
}

#[test]
fn owner_activity_before_first_claim_revives_vault() {
    let mut env = Env::funded(SOL);
    let owner = env.owner.insecure_clone();
    let a = env.heir_a.insecure_clone();
    env.advance(INTERVAL + GRACE + 100); // expired, but nobody claimed yet
    let ix = env.heartbeat_ix(&owner.pubkey());
    env.send(ix, &owner).unwrap();
    let ix = env.claim_ix(&a.pubkey());
    expect_err(env.send(ix, &a), "StillLocked");
}

#[test]
fn deposit_after_snapshot_is_impossible_and_stray_lamports_go_to_last_heir() {
    let mut env = Env::funded(SOL);
    let a = env.heir_a.insecure_clone();
    let b = env.heir_b.insecure_clone();
    env.advance(INTERVAL + GRACE);
    let ix = env.claim_ix(&a.pubkey());
    env.send(ix, &a).unwrap();
    // Someone sends SOL straight to the PDA with a plain system transfer.
    let s = env.stranger.insecure_clone();
    let vault = vault_pda(&env.owner.pubkey());
    let ix = anchor_lang::solana_program::system_instruction::transfer(&s.pubkey(), &vault, 1_000);
    env.send(ix, &s).unwrap();
    let b0 = env.lamports(&b.pubkey());
    let ix = env.claim_ix(&b.pubkey());
    env.send(ix, &b).unwrap();
    assert_eq!(env.lamports(&b.pubkey()), b0 + SOL * 4 / 10 + 1_000 - 5_000);
    assert_eq!(env.lamports(&vault), env.rent_min());
}

// ---------- guardian ----------

#[test]
fn guardian_pause_delays_unlock_bounded() {
    let mut env = Env::funded(SOL);
    let g = env.guardian.insecure_clone();
    let a = env.heir_a.insecure_clone();
    let s = env.stranger.insecure_clone();

    let ix = env.pause_ix(&s.pubkey(), 3600);
    expect_err(env.send(ix, &s), "NotGuardian");
    let ix = env.pause_ix(&g.pubkey(), 0);
    expect_err(env.send(ix, &g), "InvalidPause");
    let ix = env.pause_ix(&g.pubkey(), 30 * 24 * 3600 + 1);
    expect_err(env.send(ix, &g), "InvalidPause");

    env.advance(INTERVAL + GRACE); // expired
    let ix = env.pause_ix(&g.pubkey(), 600);
    env.send(ix, &g).unwrap();
    let ix = env.claim_ix(&a.pubkey());
    expect_err(env.send(ix, &a), "StillLocked");
    // Guardian cannot withdraw or claim.
    let ix = env.withdraw_ix(&g.pubkey(), 1);
    expect_err(env.send(ix, &g), "ConstraintSeeds");
    let ix = env.claim_ix(&g.pubkey());
    expect_err(env.send(ix, &g), "NotHeir");

    for _ in 0..2 {
        let ix = env.pause_ix(&g.pubkey(), 600);
        env.send(ix, &g).unwrap();
    }
    let ix = env.pause_ix(&g.pubkey(), 600);
    expect_err(env.send(ix, &g), "TooManyPauses");

    env.advance(600);
    let ix = env.claim_ix(&a.pubkey());
    env.send(ix, &a).unwrap();
}

#[test]
fn owner_heartbeat_clears_pause_and_resets_pause_budget() {
    let mut env = Env::funded(SOL);
    let g = env.guardian.insecure_clone();
    let owner = env.owner.insecure_clone();
    for _ in 0..3 {
        let ix = env.pause_ix(&g.pubkey(), 3600);
        env.send(ix, &g).unwrap();
    }
    let ix = env.heartbeat_ix(&owner.pubkey());
    env.send(ix, &owner).unwrap();
    let v = env.vault();
    assert_eq!(v.pauses_used, 0);
    assert_eq!(v.paused_until, 0);
    let ix = env.pause_ix(&g.pubkey(), 3600);
    env.send(ix, &g).unwrap();
}

// ---------- update / cancel / guide ----------

#[test]
fn update_config_validates_and_counts_as_heartbeat() {
    let mut env = Env::funded(SOL);
    let owner = env.owner.insecure_clone();
    env.advance(80);
    let ix = env.update_ix(&owner.pubkey(), Some(env.heirs(7_000, 2_000)), None);
    expect_err(env.send(ix, &owner), "SharesNotFull");
    let ix = env.update_ix(&owner.pubkey(), None, Some(10));
    expect_err(env.send(ix, &owner), "InvalidInterval");
    let ix = env.update_ix(&owner.pubkey(), Some(env.heirs(2_500, 7_500)), Some(3600));
    env.send(ix, &owner).unwrap();
    let v = env.vault();
    assert_eq!(v.heirs[1].share_bps, 7_500);
    assert_eq!(v.checkin_interval_secs, 3600);
    assert_eq!(v.last_heartbeat, env.now());
}

#[test]
fn set_guide_hash_owner_only() {
    let mut env = Env::funded(SOL);
    let owner = env.owner.insecure_clone();
    let s = env.stranger.insecure_clone();
    let hash = [7u8; 32];
    let mk = |signer: &Pubkey, vault: Pubkey| {
        Instruction::new_with_bytes(
            pid(),
            &heirloom::instruction::SetGuideHash { guide_hash: hash }.data(),
            heirloom::accounts::OwnerAction { owner: *signer, vault }.to_account_metas(None),
        )
    };
    let vault = vault_pda(&owner.pubkey());
    expect_err(env.send(mk(&s.pubkey(), vault), &s), "ConstraintSeeds");
    env.send(mk(&owner.pubkey(), vault), &owner).unwrap();
    assert_eq!(env.vault().guide_hash, hash);
}

#[test]
fn cancel_returns_everything_and_closes() {
    let mut env = Env::funded(3 * SOL);
    let owner = env.owner.insecure_clone();
    let vault = vault_pda(&owner.pubkey());
    let total = env.lamports(&vault);
    let before = env.lamports(&owner.pubkey());
    let s = env.stranger.insecure_clone();
    let ix = env.cancel_ix(&s.pubkey());
    expect_err(env.send(ix, &s), "ConstraintSeeds");
    let ix = env.cancel_ix(&owner.pubkey());
    env.send(ix, &owner).unwrap();
    assert_eq!(env.lamports(&owner.pubkey()), before + total - 5_000);
    assert!(env.svm.get_account(&vault).map(|a| a.lamports == 0).unwrap_or(true));
    // Owner can start over with a fresh vault.
    let ix = env.init_ix(env.heirs(5_000, 5_000), 60, 0);
    env.send(ix, &owner).unwrap();
}

#[test]
fn fake_vault_owned_by_another_program_is_rejected() {
    let mut env = Env::funded(SOL);
    let a = env.heir_a.insecure_clone();
    env.advance(INTERVAL + GRACE);
    // Copy the real vault's bytes into a system-owned account at the same address.
    let vault = vault_pda(&env.owner.pubkey());
    let mut acc = env.svm.get_account(&vault).unwrap();
    acc.owner = system_program::ID;
    env.svm.set_account(vault, acc).unwrap();
    let ix = env.claim_ix(&a.pubkey());
    expect_err(env.send(ix, &a), "AccountOwnedByWrongProgram");
}

#[test]
fn five_heirs_claim_in_any_order() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let heirs_kp: Vec<Keypair> = (0..5).map(|_| Keypair::new()).collect();
    for h in &heirs_kp {
        env.svm.airdrop(&h.pubkey(), SOL).unwrap();
    }
    let mk = |shares: [u16; 5]| -> Vec<Heir> {
        heirs_kp
            .iter()
            .zip(shares.iter())
            .map(|(k, s)| Heir { key: k.pubkey(), share_bps: *s })
            .collect()
    };
    // A zero share is rejected even when the total is right.
    let ix = env.init_ix(mk([3_334, 3_333, 3_333, 0, 0]), 60, 0);
    expect_err(env.send(ix, &owner), "ZeroShare");
    let heirs = mk([3_332, 3_333, 3_333, 1, 1]);
    let ix = env.init_ix(heirs.clone(), 60, 0);
    env.send(ix, &owner).unwrap();
    let pot = 1_000_003u64;
    let ix = env.deposit_ix(&owner.pubkey(), pot);
    env.send(ix, &owner).unwrap();
    env.advance(60);
    let order = [3usize, 0, 4, 2, 1];
    let mut paid = 0u64;
    for (n, &i) in order.iter().enumerate() {
        let before = env.lamports(&heirs_kp[i].pubkey());
        let ix = env.claim_ix(&heirs_kp[i].pubkey());
        env.send(ix, &heirs_kp[i]).unwrap();
        let got = env.lamports(&heirs_kp[i].pubkey()) + 5_000 - before;
        if n < 4 {
            assert_eq!(got, pot * heirs[i].share_bps as u64 / 10_000);
        }
        paid += got;
    }
    assert_eq!(paid, pot);
    assert_eq!(env.vault().status, VaultStatus::Settled);
}
