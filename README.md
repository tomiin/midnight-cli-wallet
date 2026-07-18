# Midnight CLI Wallet

A small command-line wallet for Midnight, built as the capstone for the Midnight
Academy wallet module. It runs the whole developer-facing surface of the wallet
stack from my own code: derive addresses, sync safely, read balances, register
NIGHT for DUST, and send a real unshielded transfer — against live infrastructure.

It started as a **Preprod** wallet and grew a network switch along the way, so the
same code runs against Preprod, Preview, or a local devnet
(`MN_NETWORK=preprod|preview|undeployed`). That switch is what let me finish: when
both public testnets were down for me one night (a dead faucet, a lagging indexer),
I stood up a local devnet and proved the full flow — including a real `send` — end
to end there.

Nothing fancy on the interface. The point was to actually run every concept from
the module against a live chain, not to build a pretty UI.

## What it does

- `address` — derive and print my unshielded + shielded addresses. Pure key math,
  no network. Run this first so you have an address to fund.
- `balance` — sync and print NIGHT + DUST at the right token scales.
- `register-dust` — register my NIGHT UTxOs so they generate DUST (the fee token).
- `sync` — the slow one: walk the DUST wallet up to the current dust state and
  checkpoint it to disk, so spending fees actually works and long syncs survive a
  restart.
- `send` — decode a recipient, then build -> sign -> prove -> submit a real NIGHT
  transfer, with the DUST fee folded in via `payFees: true`. Rebuilds the transfer
  on a stale-fee rejection (see error 170 below).

## Networks

Pick the target with the `MN_NETWORK` env var (defaults to `preprod`):

| `MN_NETWORK` | What it is | Funding |
|---|---|---|
| `preprod` | Midnight Preprod public testnet | faucet |
| `preview` | Midnight Preview public testnet | faucet |
| `undeployed` | Local Docker devnet (`devnet.yml`) | pre-minted to the genesis seed — no faucet |

Endpoints live in `src/config.ts`, and the checkpoint file is per-network so the
chains never mix.

## Prerequisites

- Node.js 20+
- A proof server at `http://localhost:6300` (standalone Docker container).
- Funds: on a public testnet, run `address` and fund the unshielded address at the
  faucet. On the local devnet you don't need a faucet at all (below).

## Quick start — local devnet (no faucet)

This is the fastest way to run the whole thing end to end, and the path I used to
finally prove `send`:

```
# 1. bring up a local node + indexer (reuses your proof server on :6300)
docker compose -f devnet.yml up -d

# 2. the dev preset pre-mints NIGHT to seed 0x00..01 — which is this wallet's seed
MN_NETWORK=undeployed NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts balance   # ~250,000,000 NIGHT

# 3. let DUST catch up (fast on a local chain), then it's spendable
MN_NETWORK=undeployed NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts sync

# 4. make a recipient and send it 5 NIGHT
MN_NETWORK=undeployed npx tsx src/index.ts print-address 0000000000000000000000000000000000000000000000000000000000000002
MN_NETWORK=undeployed NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts send <that-address> 5
```

Stop it with `docker compose -f devnet.yml down` (add `-v` to wipe chain state).

## Running it — public testnet (Preprod / Preview)

```
MN_NETWORK=preprod npx tsx src/index.ts address
# fund the unshielded address at the faucet, give it a minute
MN_NETWORK=preprod NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts balance
MN_NETWORK=preprod NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts register-dust
MN_NETWORK=preprod NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts sync      # to completion
MN_NETWORK=preprod NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/index.ts send mn_addr_preprod1... 0.5
```

Honest status: on Preprod, `address` / `balance` / `register-dust` / `sync` all run
against the live chain. `send` is subject to the Preprod indexer lag that produces
error 170 (below) — the same rebuild-on-170 fix that lands the transfer on the
local devnet is what lands it on Preprod once the indexer is caught up.

## Setup (from scratch)

```
npm init -y
npm pkg set type=module
npm install @midnight-ntwrk/wallet-sdk @midnight-ntwrk/midnight-js-protocol rxjs
npm install -D typescript tsx @types/node
```

Pin whatever actually installs rather than trusting a number from memory:
`npm ls @midnight-ntwrk/wallet-sdk @midnight-ntwrk/midnight-js-protocol`.

## Notes worth knowing

- **Error 170 on `send` = a stale DUST fee proof.** 170 is `InvalidDustSpendProof`:
  the node rejects the *fee* leg because it was balanced against a dust state the
  chain has already moved past. Resubmitting the same finalized transaction can
  never fix that — it carries the same dead proof. So `send` rebuilds the whole
  transfer (re-balancing the DUST against the current state) on each retry. On a
  live chain the first attempt often 170s and the fresh rebuild goes through. Full
  story in `ROADBLOCKS.md`.
- **The sync is timeout-safe on purpose**, and only `sync` walks the DUST wallet to
  completion. `balance` waits on the unshielded wallet only (it never blocks on the
  slow, memory-heavy shielded scan), so `balance` can read `DUST: 0` until you have
  run `sync` — that is expected, not a bug.
- **The seed is hardcoded** (`0000...0001`) so the flow is reproducible. On the
  local devnet that is also the genesis-funded account, which is why no faucet is
  needed. Never hardcode a seed for a real wallet — that is the first item in my
  write-up's "what I'd add next."

## Built for

The Midnight Academy wallet module capstone.
