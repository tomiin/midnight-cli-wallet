// src/config.ts — network endpoints, network ID, and token scales.
//
// The target network is chosen with the MN_NETWORK env var:
//     MN_NETWORK=preprod   (default) — the original capstone target
//     MN_NETWORK=preview             — Midnight's Preview testnet
// Endpoints verified against the live networks (indexer serves /api/v4/graphql
// on both). The proof server always runs locally on :6300.
import { NetworkId } from '@midnight-ntwrk/wallet-sdk';

export const NETWORK_NAME = (process.env.MN_NETWORK ?? 'preprod').toLowerCase();

type NetCfg = {
  networkId: unknown;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  node: string;
  proofServer: string;
};

const NETWORKS: Record<string, NetCfg> = {
  preprod: {
    networkId: NetworkId.NetworkId.PreProd,
    indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'wss://rpc.preprod.midnight.network',
    proofServer: 'http://localhost:6300',
  },
  preview: {
    networkId: NetworkId.NetworkId.Preview,
    indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'wss://rpc.preview.midnight.network',
    proofServer: 'http://localhost:6300',
  },
  undeployed: {
    // Local Docker devnet (midnight-tooling devnet: node 9944, indexer 8088).
    // The dev preset pre-mints NIGHT to seed 0x00..01 (the wallet's own seed),
    // so this network needs no faucet.
    networkId: NetworkId.NetworkId.Undeployed,
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    node: 'ws://localhost:9944',
    proofServer: 'http://localhost:6300',
  },
};

const selected = NETWORKS[NETWORK_NAME];
if (!selected) {
  throw new Error(
    `Unknown MN_NETWORK "${NETWORK_NAME}". Use "preprod" or "preview".`,
  );
}

export const NETWORK_ID = selected.networkId as typeof NetworkId.NetworkId.PreProd;
export const networkConfig = {
  indexerHttpUrl: selected.indexerHttpUrl,
  indexerWsUrl: selected.indexerWsUrl,
  node: selected.node,
  proofServer: selected.proofServer,
};

// Token scales
export const MICRO_NIGHT = 1_000_000n;             // 1 NIGHT = 1,000,000 micro-NIGHT
export const DUST_SPECKS = 1_000_000_000_000_000n; // 1 DUST = 10^15 specks
