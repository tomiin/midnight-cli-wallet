// src/commands/balance.ts — sync and print balances
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { DUST_SPECKS, MICRO_NIGHT, NETWORK_NAME } from '../config';
import { buildWallet, startAndSync } from '../wallet';

export async function balanceCommand(seed: Buffer) {
  const bundle = await buildWallet(seed);
  console.log(`Syncing with ${NETWORK_NAME}… (first sync can take a minute)`);
  const state = await startAndSync(bundle);

  const nightMicro = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  const dustSpecks = state.dust.balance(new Date());

  console.log('=== Balances ===');
  console.log(`NIGHT: ${Number(nightMicro) / Number(MICRO_NIGHT)} (${nightMicro} micro)`);
  console.log(`DUST:  ${Number(dustSpecks) / Number(DUST_SPECKS)} (${dustSpecks} specks)`);
  console.log(`Unshielded UTxOs: ${state.unshielded.availableCoins.length}`);

  await bundle.facade.stop();
}
