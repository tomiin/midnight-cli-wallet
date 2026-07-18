// src/index.ts — CLI entry point and command router
import { Buffer } from 'buffer';
import { addressCommand } from './commands/address';
import { balanceCommand } from './commands/balance';
import { registerDustCommand } from './commands/register-dust';
import { syncCommand } from './commands/sync';
import { sendCommand } from './commands/send';

// Fixed seed for a reproducible tutorial. NEVER hardcode a real seed —
// generate it randomly and store it securely.
const SEED = Buffer.from(
  '0000000000000000000000000000000000000000000000000000000000000001',
  'hex'
);

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'address': addressCommand(SEED); break;
    case 'balance': await balanceCommand(SEED); break;
    case 'register-dust': await registerDustCommand(SEED); break;
    case 'sync': await syncCommand(SEED); break;
    case 'send': {
      const recipient = process.argv[3];
      const amount = Number(process.argv[4] ?? '0');
      if (!recipient || !(amount > 0)) {
        console.log('Usage: tsx src/index.ts send <recipientAddress> <amountInNight>');
        break;
      }
      await sendCommand(SEED, recipient, amount);
      break;
    }
    default:
      console.log('Usage: tsx src/index.ts [address|balance|register-dust|sync|send]');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
