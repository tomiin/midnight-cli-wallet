# Roadblocks and workarounds

I'm building this as a self-taught enthusiast, not a career dev, so I want to be
honest about what actually happened. The tutorial code was a starting point, but
almost nothing ran clean on the first try. The SDK moves fast and my machine and
the test network both had opinions. Here's every wall I hit and how I got past it,
in order, so the next person doesn't burn the hours I did.

## 1. The endpoint URLs came in with junk around them

When I first pasted the config, the network URLs had angle brackets around them
(`<https://...>`) — leftover formatting from copy-paste. TypeScript happily
accepted them as strings, so nothing complained until the wallet tried to connect
to a garbage address. Fix was boring but easy: strip the brackets so the URLs in
`src/config.ts` are clean.

Lesson I'm keeping: if a connection fails instantly, check the literal string
before blaming the network.

## 2. Getting a proof server running

Nothing that touches a real transaction works without a proof server, and it's not
something the SDK spins up for you. I ran it as a standalone Docker container on
port 6300 (not the local devnet flavor — this is for the public testnet). Health
check at `/health` returns `{"status":"ok"}` when it's actually up. Once that was
green, the rest of the commands had something to prove against.

## 3. The official faucet was dead

To do anything I needed test NIGHT in the wallet, and the faucet the docs point at
(`faucet.preprod.midnight.network`) was down — not slow, just gone. The one that
actually worked was Nethermind's: `https://midnight-tmnight-preprod.nethermind.dev/`.
Funded the unshielded address there and the balance finally showed up (~13,645 NIGHT).

Lesson: on a testnet, "the endpoint in the docs is down" is a normal Tuesday. Have
a backup provider in mind.

## 4. `balance` ate all my RAM and crashed

First real run of `balance` died with `JavaScript heap out of memory` at around
3.9 GB. Turns out the unshielded side reaches the chain tip in a couple seconds,
but the shielded wallet quietly trial-decrypts the entire chain history in the
background, and that blows past Node's default ~4 GB heap.

Workaround: I've got 24 GB on this Mac, so I gave Node room with
`NODE_OPTIONS=--max-old-space-size=16384`. I also learned I can stop the proof
server while just checking balance, since reading a balance needs no proving — that
frees up memory too.

## 5. `balance` synced to the tip, then hung for 10 minutes anyway

This one cost me the most time. Even with the bigger heap, `balance` would reach
`X/X transactions` — clearly at the tip — and then sit there until it hit the
600-second timeout and gave up. The wallet was done syncing; my code just didn't
know it.

Root cause was SDK drift. The tutorial's "are we synced yet" check called methods
and read fields (`isStrictlyComplete()`, dust index fields) that don't exist in the
version of the SDK I actually have installed, so the check never returned true.

How I fixed it instead of guessing: I dumped the real shape of the wallet state to
the console — the actual keys the SDK gives me — and rewrote the sync check to use
what's really there. On my version, `unshielded.progress` gives `appliedId` and
`highestTransactionId`, so "synced" means `appliedId >= highestTransactionId` (and
the highest is above zero). After that patch, `balance` finished in about a second:
13,645.12 NIGHT, 0 DUST, 10 UTxOs.

Lesson I'm keeping, and it's the big one: with this SDK, don't trust what the
tutorial says the state looks like. Print it and check. Compiling proves nothing;
running it is the only truth.

## 6. `register-dust` built and signed fine, then failed at submit

Registering NIGHT for DUST is the fiddly command — it shapes coins, builds a
generation transaction, grabs the intent, signs it, finalizes. All of that worked
first try, which surprised me given how much else drifted. It printed
"Registering 1 NIGHT UTxO(s)…" and then died at the very last step: submitting to
the node.

The error was `disconnected from wss://rpc.preprod.midnight.network/: 1000: Normal
Closure`. So the transaction was fully built and proven, but the node's websocket
kept dropping the connection right as it tried to submit — the same "official
endpoint is flaky" story as the dead faucet.

Before assuming I could just point at a different node, I checked Midnight's own
endpoint docs. `rpc.preprod.midnight.network` is the only Preprod node they list —
Nethermind only runs the faucet UI, not a second RPC. So swapping endpoints wasn't
an option; the fix had to be about surviving the flakiness.

Workaround: since the transaction was already built, signed, and proven, re-running
the whole command (and re-syncing every time) was wasteful. Instead I wrapped just
the submit step in a small retry loop — up to 5 tries with growing waits between
them (3s, 6s, 9s, 12s), reusing the exact same finished transaction each time. The
`@polkadot` provider reconnects on its own between tries. On the next run the first
attempt hit the dropped socket, the retry 3 seconds later went straight through,
and the node accepted it. Tx hash in hand.

Lesson: separate the expensive work (proving) from the flaky work (submitting), and
only retry the flaky part.

## 7. `send` built and proved, then the node said "170"

This is the command the whole capstone is really about, and it's where I hit the
wall that cost me the most. `send` would sync, confirm DUST, build the transfer,
prove it, and submit — and the node would reject it with
`1010: Invalid Transaction: Custom error: 170`. Every time.

170 is `InvalidDustSpendProof`. It isn't the amount or the recipient — it's the
DUST *fee* leg. The wallet balances a little DUST to pay the fee and proves that
spend; the node checks that proof against its current dust state and says no.

## 8. Chasing 170 across three networks

For a long time I assumed it was just Preprod being Preprod. A Midnight dev
confirmed the shape of it: when the public indexer runs behind the node's tip, the
wallet builds the DUST spend against a stale view and the node — at the real tip —
rejects it. Their advice was to wait for the indexer to catch up and, tellingly,
"rebuild, don't reuse a stale balanced tx." I filed that away. It turned out to be
the whole answer.

While I waited on Preprod I tried Preview instead (that's when I added the
`MN_NETWORK` switch so I could point the same code at either network). Preview's
faucet human-check spun forever and then locked me out for 24 hours, and its node
dropped my sync the same way Preprod's did. So both public testnets were dead ends
the same night — one from a lagging indexer, one from a broken faucet. Classic
testnet Tuesday, doubled.

## 9. The local devnet that finally told the truth

With both public networks against me, I stood up a local devnet in Docker —
`devnet.yml`, just a node and an indexer, reusing my existing proof server on 6300.
The dev preset pre-mints NIGHT to seed `0x00..01`, which is the exact seed this
wallet already uses, so I was funded with ~250 million NIGHT and zero faucet.

Then the important part: `send` *still* failed with **170** — on a local chain,
with the indexer sitting right at the node's tip and no lag anywhere. That killed
the "it's just Preprod infra" story dead. If a fully-synced local chain rejects the
spend too, the problem is in how the transaction is built, not the network. Which
meant it was mine to fix.

## 10. The actual bug: I was resubmitting a corpse

Here's what I'd gotten wrong. My retry logic — the same pattern that saved
`register-dust` back in section 6 — took the finished, proven transaction and
resubmitted that *exact same object* on each try. That's fine for a dropped socket.
It's useless for a 170, because the DUST proof inside that transaction is tied to a
dust state that's already a block in the past. Resubmitting it just re-presents the
same dead proof. On the local chain, which mints a block every few seconds, the
proof goes stale almost the instant it's built.

The fix is exactly what the dev said and what I'd skipped past: don't reuse a stale
balanced tx — *rebuild* it. I moved the whole build -> sign -> prove -> submit into
the retry loop, so every attempt re-balances the DUST against the current state and
carries a fresh proof. First run after the change: attempt 1 hit 170, attempt 2
rebuilt and went straight through. `Transfer submitted. Tx: 00fe58...`. NIGHT
dropped by exactly the 5 I sent, fee paid in DUST. I ran it again to be sure it
wasn't luck — same clean result, a second transfer.

Lesson, and it's the sharpest one in here: a retry is only worth anything if the
thing you retry is *different* from the thing that just failed. For a flaky socket,
resend. For a rejected proof, rebuild. I'd copied a retry that resent, and it could
never have worked no matter how many times it ran.

## The theme

Almost every wall was one of three things: my machine not having enough room, a
public testnet endpoint being unreliable, or the SDK having quietly changed shape
since the tutorial. The `send` one was subtler — my own retry doing the wrong kind
of retry — but the habit that got me through was the same throughout: refuse to
guess. Dump the real state, read the real docs, reproduce the failure somewhere I
control, and fix the actual cause instead of the one I assumed. The local devnet
was the tool that turned "the network is broken" into "my code is wrong," and that
was the turning point.
