// src/commands/address.ts — derive and print addresses (no network needed)
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  PublicKey, createKeystore, MidnightBech32m,
  ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk';
import { NETWORK_ID } from '../config';
import { deriveUnshieldedSeed, deriveShieldedSeed } from '../keys';

export function addressCommand(seed: Buffer) {
  const keystore = createKeystore(deriveUnshieldedSeed(seed), NETWORK_ID);
  const unshielded = PublicKey.fromKeyStore(keystore).address;

  const zswap = ledger.ZswapSecretKeys.fromSeed(deriveShieldedSeed(seed));
  const shieldedAddr = new ShieldedAddress(
    new ShieldedCoinPublicKey(Buffer.from(zswap.coinPublicKey, 'hex')),
    new ShieldedEncryptionPublicKey(Buffer.from(zswap.encryptionPublicKey, 'hex')),
  );
  const shielded = MidnightBech32m.encode(NETWORK_ID, shieldedAddr).asString();

  console.log('=== Your Addresses ===');
  console.log('Unshielded:', unshielded);
  console.log('Shielded:  ', shielded);
}
