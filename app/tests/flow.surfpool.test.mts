// End-to-end flow through the generated Kit client against an embedded Surfpool surfnet.
// Run: npm run test:surfpool   (after `anchor build` at the repo root)
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { address, createClient, fetchEncodedAccount, generateKeyPairSigner, lamports, type Instruction } from '@solana/kit';
import { surfpool } from '@solana/surfpool/kit';
import {
  HEIRLOOM_PROGRAM_ADDRESS,
  fetchVault,
  viewVault,
  ixInitialize,
  ixDeposit,
  ixHeartbeat,
  ixClaim,
  ixGuardianPause,
  VaultStatus,
} from '../src/lib/heirloom';

const client = await createClient().use(surfpool());
after(() => client.surfnet.stop());

client.surfnet.deploy({
  programId: HEIRLOOM_PROGRAM_ADDRESS,
  soPath: path.resolve(import.meta.dirname, '../../target/deploy/heirloom.so'),
});

const SOL = 1_000_000_000;

async function send(ixs: Instruction[]) {
  return client.sendTransaction(ixs);
}

// Read unix_timestamp straight from the Clock sysvar (offset 32, i64 LE).
async function chainTime(): Promise<number> {
  const acc = await fetchEncodedAccount(client.rpc, address('SysvarC1ock11111111111111111111111111111111'));
  if (!acc.exists) throw new Error('no clock');
  return Number(new DataView(acc.data.buffer, acc.data.byteOffset).getBigInt64(32, true));
}

test('create, check in, expire, claim 60/40 through the Kit client', async () => {
  const owner = await generateKeyPairSigner();
  const heirA = await generateKeyPairSigner();
  const heirB = await generateKeyPairSigner();
  const guardian = await generateKeyPairSigner();
  for (const k of [owner, heirA, heirB, guardian]) client.surfnet.fundSol(k.address, 5 * SOL);

  await send([
    await ixInitialize({
      owner,
      heirs: [
        { key: heirA.address, shareBps: 6000 },
        { key: heirB.address, shareBps: 4000 },
      ],
      intervalSecs: 90,
      graceSecs: 30,
      guardian: guardian.address,
    }),
    await ixDeposit(owner, BigInt(SOL)),
  ]);

  let v = await fetchVault(client.rpc, owner.address);
  assert.ok(v);
  const rentMin = await client.rpc.getMinimumBalanceForRentExemption(BigInt(v.dataLength)).send();
  assert.equal(v.lamports - rentMin, BigInt(SOL));
  assert.equal(viewVault(v, rentMin, Number(v.data.lastHeartbeat)).phase, 'active');

  await send([await ixHeartbeat(owner, owner.address)]);

  // A claim before expiry fails on-chain.
  await assert.rejects(send([await ixClaim(heirA, owner.address)]));

  // Jump the clock past interval + grace.
  v = (await fetchVault(client.rpc, owner.address))!;
  client.surfnet.timeTravelToTimestamp((Number(v.data.lastHeartbeat) + 90 + 30 + 5) * 1000);
  const now = await chainTime();
  assert.equal(viewVault(v, rentMin, now).phase, 'claimable');

  // Guardian is still allowed to pause before the first claim; it blocks the claim.
  await send([await ixGuardianPause(guardian, owner.address, 60)]);
  await assert.rejects(send([await ixClaim(heirA, owner.address)]));
  client.surfnet.timeTravelToTimestamp((now + 70) * 1000);

  const a0 = (await client.rpc.getBalance(heirA.address).send()).value;
  await send([await ixClaim(heirA, owner.address)]);
  const a1 = (await client.rpc.getBalance(heirA.address).send()).value;
  assert.equal(a1 - a0, lamports(600_000_000n)); // surfnet payer pays the fee

  await assert.rejects(send([await ixClaim(heirA, owner.address)]), 'double claim must fail');

  await send([await ixClaim(heirB, owner.address)]);
  v = (await fetchVault(client.rpc, owner.address))!;
  assert.equal(v.data.status, VaultStatus.Settled);
  assert.equal(v.lamports, rentMin);
});
