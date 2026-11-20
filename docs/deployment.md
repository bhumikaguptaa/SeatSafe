# Deployment and setup

## Deployed addresses (Solana devnet)

| What | Address |
| --- | --- |
| SeatSafe program | [`7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy`](https://explorer.solana.com/address/7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy?cluster=devnet) |
| Config PDA | [`4fW9Z3ZkBHkCA4LubaWVox7Awu298oyLFhjQ7hi8XDry`](https://explorer.solana.com/address/4fW9Z3ZkBHkCA4LubaWVox7Awu298oyLFhjQ7hi8XDry?cluster=devnet) (fee 3%, dispute window 72 h) |
| Ticket authority PDA (mint + freeze authority) | `ECzfNYDLy1VBARppGPu86SAoWRV9LAsX9jpybdYn5LjR` |
| USDC mint (Circle devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Deployer, admin, treasury | `2VHBVmwU6C5NLdKjpykvJdGYWoSUw5uHAq3EKTbLHTqv` |
| Relayer | `7r2SszeUx3xyJsjAeUYvveMMmvkjjvxbPhxUGiP78g61` |
| Arbiter | `5AFvU5Cyxy6bUMbhumhmeJeRLbNxPjgr8bqKXENxnbjr` |
| Demo event: Battle of the Bands ($10, cap $15) | [`EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE`](https://explorer.solana.com/address/EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE?cluster=devnet) |
| Demo event: Neon Harbor ($75, cap $120) | `Hw1cWsKxef959oD338Qx86TjDt2km4XXRBqPgxjjvL7a` |
| Demo event: UT vs. A&M ($85, cap $130) | `6hW7X8JNFfwhU7Qx3dFTyy3LUa5tsCvMWyFhREdZZXzs` |

## Prerequisites

Node.js 20+ for the app. For the program: Rust (the program pins 1.89.0 via `program/rust-toolchain.toml`), Solana CLI (Agave) 4.3.2, Anchor CLI 1.2.2 via avm. Install guide: https://solana.com/docs/intro/installation

## Run the app

Mock data, no keys: `cd app && npm install && npm run dev`, then open http://localhost:3000.

Against devnet: copy `app/.env.example` to `app/.env.local` (never commit it):

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_USE_MOCK` | `false` for devnet |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app with email/Google login and Solana embedded wallets |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Devnet RPC (public or QuickNode) |
| `NEXT_PUBLIC_USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `NEXT_PUBLIC_PROGRAM_ID` | `7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy` |
| `NEXT_PUBLIC_RELAYER_PUBKEY` / `RELAYER_SECRET_KEY` | Relayer public / secret key (secret: server only) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase project (service key: server only) |
| `STREAM_WEBHOOK_SECRET`, `CRON_SECRET` | Server only |
| `NEXT_PUBLIC_APP_URL` | Deployed URL |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Voice approval and agent parsing |

Apply `supabase/*.sql` to the Supabase project. `npm run demo:devnet` runs the buy / over-cap / resale / escrow-refund flows on devnet without a browser.

## Program: build, test, deploy

```bash
cd program
npm install
anchor build
npm test             # = anchor test --validator legacy (plain `anchor test` starts Surfpool, which fails here)
npm run sync-idl     # copy the IDL + types into app/lib/idl/
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

Keypairs live outside git: deployer in `~/.config/solana/id.json`, relayer and arbiter in `.keys/` (git-ignored).

## Demo data

```bash
cd program
anchor run seed-devnet --provider.cluster devnet   # once: demo events
anchor run reset-demo  --provider.cluster devnet   # before each demo: fresh resale + escrow listings
```

`reset-demo` needs devnet USDC in the seed seller (`29ZQN6eHpp5VJH3zLSgC7UVUYsrb6czgrqEKb61LnzUs`); top up at https://faucet.circle.com.

## Repo layout

```
program/     Anchor workspace (seatsafe) + scripts (init-devnet, seed-devnet, reset-demo)
app/         Next.js app: routes, components, lib (program.ts, tx.ts, chain.ts, hooks.ts)
supabase/    schema
docs/        program reference, backend, deployment, demo checklist, Grok chat export
```
