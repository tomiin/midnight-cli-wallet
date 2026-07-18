# Capstone write-up

## What I'd add next

The first thing I'd fix is the hardcoded seed. The whole wallet runs off
`0000…0001`, which is fine for a reproducible tutorial but obviously isn't a
wallet — it's the same identity everyone else following this uses. Step one is
`generateRandomSeed()`, persisted to an encrypted file and loaded on startup, so
the CLI actually owns an identity instead of borrowing a public one.

After that, a `watch` command. Every command here does a cold sync, prints one
snapshot, and exits. But the wallet already exposes `facade.state()` as a live
stream, so a `watch` that subscribes and prints balance changes as they land would
turn this from a set of one-shots into something I can leave running while I test.
It would also make DUST accrual visible in real time, which right now I only see by
re-running `balance` and diffing in my head.

I'd also add retry-on-138 to `register-dust`. On a fresh wallet that call fails
with error 138 fairly often, and the fix is just to rebuild with a new timestamp
and try again — so wrapping it in an automatic retry loop for ~10 minutes would
remove the one manual, confusing step in the whole flow. And eventually a
`send-shielded` command, because right now I only ever exercise the public,
unshielded side. The whole point of Midnight is the private side, and I haven't
actually moved a shielded token yet.

## One thing that surprised me

The DUST model, and specifically the way it leaks into the sync. I came in
assuming I'd pay fees with NIGHT, the way you pay gas with the native token
everywhere else. You don't. You hold NIGHT, register it, and it *generates* DUST
over time — a renewable fee resource, not a balance you spend down. That alone was
a rethink.

But the thing that actually cost me time was a direct consequence of that design:
the sync can hang forever on an idle chain. The DUST wallet only reports itself
"connected" once a non-empty batch of DUST events arrives, and on a quiet testnet
that batch may never come — so the SDK's built-in `isSynced` never flips to true,
and you sit there waiting on a wallet that is actually finished. The fix was to
stop trusting `isSynced`, check the sync indices directly, and not block on the
shielded wallet at all since this CLI never shows a shielded balance. It's a small
piece of code, but it's the difference between the tool working and the tool
looking frozen — and it only makes sense once you understand that DUST is a
separate, event-driven thing bolted onto the wallet, not just another number.

## The bug that taught me the most

The `send` command is where this stopped being a tutorial and became mine. It kept
failing with error 170 — `InvalidDustSpendProof` — the node rejecting the DUST fee
proof. I spent a long time sure it was the public testnet's fault (a Midnight dev
even confirmed the indexer-lag version of it), and both public networks really were
broken for me that night: Preprod's indexer was behind, Preview's faucet was dead.

What broke it open was standing up a local devnet and watching `send` throw the
*same* 170 on a chain that was perfectly in sync with itself. That proved it wasn't
the network — it was my code. My retry loop was resubmitting the exact same proven
transaction each time, and a DUST proof goes stale the moment the chain advances a
block, so I was re-presenting a dead proof over and over. The fix was to rebuild the
whole transfer on each retry so it re-balances the DUST against the current state —
which is exactly the "don't reuse a stale balanced tx" advice I'd been given and
skipped past. First run after the change, attempt two went straight through and the
NIGHT actually moved.

The lesson I'm keeping: a retry only helps if the next attempt is *different* from
the one that failed. And when a public network keeps telling you "it's infra,"
reproduce the failure somewhere you fully control before you believe it — the local
devnet is what turned "the chain is broken" into "my retry is wrong."
