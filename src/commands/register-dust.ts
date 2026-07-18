// src/commands/register-dust.ts — register NIGHT UTxOs for DUST generation
//
// Rewritten to the canonical facade API after the tutorial's manual path
// (createDustGenerationTransaction + hand-signed intent + state.dust.address)
// broadcast a tx that never actually registered — state.dust.address was
// undefined on this SDK build, so no DUST accrued. This path signs internally
// and lets the receiver default to our own dust address.
import { buildWallet, startAndSync } from '../wallet';
import { submitWithRetry } from '../submit';

export async function registerDustCommand(seed: Buffer) {
  const bundle = await buildWallet(seed);
  const { facade, keystore } = bundle;

  console.log('Syncing…');
  const state = await startAndSync(bundle);

  const allCoins = state.unshielded.availableCoins;
  const alreadyRegistered = allCoins.filter(
    (c: any) => c.meta?.registeredForDustGeneration === true,
  ).length;
  // Register only coins the chain says are NOT yet generating dust.
  const nightUtxos = allCoins.filter(
    (c: any) => c.meta?.registeredForDustGeneration === false,
  );

  console.log(`NIGHT UTxOs total: ${allCoins.length}  already registered: ${alreadyRegistered}  to register: ${nightUtxos.length}`);

  if (nightUtxos.length === 0) {
    console.log('Nothing to register — every NIGHT UTxO is already generating DUST.');
    console.log('If DUST still reads 0, give it a few blocks and re-check balance.');
    await facade.stop();
    return;
  }

  // Optional: preview the fee + per-UTxO dust yield. Non-fatal if it errors.
  try {
    const est = await facade.estimateRegistration(nightUtxos);
    console.log(`Estimated registration fee: ${est.fee}`);
  } catch (err: any) {
    console.error(`  (estimateRegistration skipped: ${String(err?.message ?? err)})`);
  }

  console.log(`Registering ${nightUtxos.length} NIGHT UTxO(s) for DUST generation…`);

  // Build the recipe — signing is handled internally via the callback, and the
  // dust receiver address defaults to our own dust wallet (4th arg omitted).
  const recipe = await facade.registerNightUtxosForDustGeneration(
    nightUtxos,
    keystore.getPublicKey(),
    (payload: Uint8Array) => keystore.signData(payload),
  );

  // Finalize (proves the tx via the proof server), then submit with retry.
  const finalized = await facade.finalizeRecipe(recipe);
  const txHash = await submitWithRetry(facade, finalized);

  console.log('Registration submitted. Tx:', txHash);

  // Watch for DUST to move off zero, so the command self-confirms. Non-fatal:
  // on Preprod it can take longer than this window, and that's fine.
  console.log('Waiting up to 90s for DUST to start accruing…');
  const start = Date.now();
  let dust = 0n;
  await new Promise<void>((resolve) => {
    let sub: any;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub?.unsubscribe();
      resolve();
    };
    sub = facade.state().subscribe((s: any) => {
      try {
        dust = s.dust.balance(new Date());
      } catch {}
      if (dust > 0n || Date.now() - start > 90_000) finish();
    });
  });

  if (dust > 0n) {
    console.log(`DUST is accruing: ${dust} specks.`);
  } else {
    console.log('DUST still 0 for now — it should appear over the next few blocks.');
    console.log('Re-run `balance` in a minute to confirm.');
  }

  await facade.stop();
}
