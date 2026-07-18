// src/commands/send.ts — send an unshielded NIGHT transfer
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';
import { NETWORK_ID } from '../config';
import { buildWallet, startAndSync } from '../wallet';

// Spending DUST needs the dust wallet CAUGHT UP to the current dust state (not
// merely showing a balance) — otherwise the node rejects the fee spend as invalid
// (custom error 170). If you restored from a fully-synced checkpoint this is
// instant; otherwise run `sync` to completion first.
async function waitForDustSynced(facade: any, timeoutMs = 180_000): Promise<bigint> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let sub: { unsubscribe: () => void };
    let done = false;
    const finish = (v?: bigint, err?: any) => {
      if (done) return;
      done = true;
      sub?.unsubscribe();
      if (err) reject(err); else resolve(v ?? 0n);
    };
    sub = facade.state().subscribe((state: any) => {
      const pr = state.dust?.progress;
      const applied = Number(pr?.appliedIndex ?? 0);
      const target = Number(pr?.highestRelevantWalletIndex ?? 0);
      const caughtUp = target > 0 && target - applied <= 10;
      let dust = 0n;
      try { dust = state.dust.balance(new Date()); } catch {}
      if ((caughtUp || state.isSynced === true) && dust > 0n) finish(dust);
      else if (Date.now() - start > timeoutMs) {
        finish(undefined, new Error(
          `DUST wallet not caught up (${applied}/${target}). Run \`sync\` to completion first, then retry send.`,
        ));
      }
    });
  });
}

export async function sendCommand(seed: Buffer, recipientString: string, nightAmount: number) {
  const bundle = await buildWallet(seed);
  const { facade, keystore, zswapSecretKeys, dustSecretKey } = bundle;

  // Decode the recipient — transferTransaction needs an address object, not a string
  const recipient = MidnightBech32m.parse(recipientString).decode(UnshieldedAddress, NETWORK_ID);

  // Convert NIGHT → micro-NIGHT (bigint)
  const amount = BigInt(Math.round(nightAmount * 1_000_000));

  console.log('Syncing…');
  await startAndSync(bundle);

  process.stdout.write('Confirming DUST wallet is caught up (needed to spend fees)… ');
  const dust = await waitForDustSynced(facade);
  console.log(`ok (${dust} specks).`);

  // Error 170 (InvalidDustSpendProof) means the dust *fee* spend was proven
  // against a dust state the node has already advanced past — the block moved
  // between balancing and submit. Resubmitting the SAME balanced tx can never
  // fix that (it carries the same stale dust proof), so on 170 we REBUILD the
  // whole transfer, re-balancing the dust against the current state each try.
  // This is the "don't reuse a stale balanced tx" guidance in practice.
  let txHash: string | undefined;
  let lastErr: any;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const ttl = new Date(Date.now() + 10 * 60 * 1000);
      console.log(`Attempt ${attempt}: building (fresh dust balance), proving, submitting…`);
      const recipe = await facade.transferTransaction(
        [
          {
            type: 'unshielded',
            outputs: [
              { amount, receiverAddress: recipient, type: ledger.unshieldedToken().raw },
            ],
          },
        ],
        { shieldedSecretKeys: zswapSecretKeys, dustSecretKey },
        { ttl, payFees: true },
      );
      const signed = await facade.signRecipe(recipe, (payload: Uint8Array) => keystore.signData(payload));
      const finalized = await facade.finalizeRecipe(signed);
      txHash = await facade.submitTransaction(finalized);
      break;
    } catch (e: any) {
      lastErr = e;
      let full = '', cur: any = e;
      while (cur) { full += ' ' + String(cur.message ?? cur); cur = cur.cause; }
      const is170 = /\b170\b/.test(full);
      const retryable = is170 || /Normal Closure|disconnected|submission error/i.test(full);
      console.error(`  attempt ${attempt} failed: ${is170 ? 'error 170 — stale dust spend, rebuilding fresh' : full.trim().slice(0, 120)}`);
      if (attempt < 8 && retryable) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw lastErr;
    }
  }

  console.log('Transfer submitted. Tx:', txHash);
  await facade.stop();
}
