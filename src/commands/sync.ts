// src/commands/sync.ts — long-running DUST catch-up sync with checkpointing.
//
// On Preprod the DUST wallet must scan ~1.3M historical generation events. A
// balance shows up early (~1%), but to *spend* DUST (pay a fee) the wallet has to
// be caught up to the current dust state — otherwise the node rejects the spend
// as invalid. So this runs the full scan to (near) the tip, checkpoints every 20s
// (crash/restart resumes), shows progress, and exits when caught up. Ctrl-C saves.
import { buildWallet } from '../wallet';
import { saveCheckpoint, checkpointPath } from '../checkpoint';

export async function syncCommand(seed: Buffer) {
  const bundle = await buildWallet(seed); // restores from checkpoint if present
  const { facade } = bundle;
  await facade.start(bundle.zswapSecretKeys, bundle.dustSecretKey);

  let latest: any = null;
  let lastApplied = 0;
  let lastTarget = 0;
  const startedAt = Date.now();

  const fmt = () => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    const pct = lastTarget > 0 ? ((lastApplied / lastTarget) * 100).toFixed(2) : '0';
    return `dust ${lastApplied}/${lastTarget} (${pct}%)  ${secs}s`;
  };

  // Save on Ctrl-C so progress is never lost.
  let stopping = false;
  const onSigint = async () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write('\n[sync] saving checkpoint before exit…\n');
    try { if (latest) await saveCheckpoint(facade, lastApplied); } catch (e) { console.error(e); }
    await facade.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', onSigint);

  console.log(`Syncing DUST. This is the slow one — checkpointing to ${checkpointPath()} every 20s.`);
  console.log('Leave it running; if it stops, just run `sync` again and it resumes. Ctrl-C is safe.\n');

  await new Promise<void>((resolve) => {
    let done = false;
    let saver: ReturnType<typeof setInterval>;
    let sub: { unsubscribe: () => void };
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(saver);
      sub?.unsubscribe();
      resolve();
    };

    sub = facade.state().subscribe((state: any) => {
      latest = state;
      const p = state.dust?.progress;
      if (p) {
        lastApplied = Number(p.appliedIndex ?? 0);
        lastTarget = Number(p.highestRelevantWalletIndex ?? 0);
      }
      let dust = 0n;
      try { dust = state.dust.balance(new Date()); } catch {}
      process.stdout.write(`\r  ${fmt()}  DUST=${dust}   `);
      // Caught up: applied index has reached (within a small gap of) the tip.
      // A balance alone is NOT enough — spending needs the current dust state.
      const caughtUp = lastTarget > 0 && lastTarget - lastApplied <= 10;
      if ((caughtUp || state.isSynced === true) && dust > 0n) {
        process.stdout.write('\n');
        console.log(`DUST wallet caught up (${lastApplied}/${lastTarget}), DUST=${dust}. You can now run \`send\`.`);
        finish();
      }
    });

    // Periodic checkpoint every 20s.
    saver = setInterval(async () => {
      if (!latest || stopping || done) return;
      try {
        await saveCheckpoint(facade, lastApplied);
        process.stdout.write(`\r  ${fmt()}  [checkpoint saved]   `);
      } catch {}
    }, 20_000);
  });

  await saveCheckpoint(facade, lastApplied);
  await facade.stop();
}
