// src/print-address.ts — print the unshielded mn_addr for any seed (no network).
// Handy for generating a second, DIFFERENT recipient to test a real transfer
// (a self-transfer can normalize to a degenerate tx the node rejects).
//   npx tsx src/print-address.ts <64-hex-seed>
import { Buffer } from 'buffer';
import { PublicKey, createKeystore } from '@midnight-ntwrk/wallet-sdk';
import { NETWORK_ID } from './config';
import { deriveUnshieldedSeed } from './keys';

const hex = (process.argv[2] || '').replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.error('Usage: npx tsx src/print-address.ts <64-hex-seed>');
  process.exit(1);
}
const seed = Buffer.from(hex, 'hex');
const keystore = createKeystore(deriveUnshieldedSeed(seed), NETWORK_ID);
console.log(PublicKey.fromKeyStore(keystore).address);
