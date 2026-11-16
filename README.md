# SeatSafe

SeatSafe is a ticketing platform on Solana where fans can buy and resell tickets without getting scammed or price-gouged. Artists sell onchain tickets (Token-2022) with a resale price cap and royalty enforced in code. Fans resell through an atomic swap, so the ticket and the USDC change hands in one transaction. Tickets from outside platforms go through an escrow vault with deadlines and automatic refunds. AI agents can fill standing orders ("2 tickets under $90") from a capped budget vault, and a live tracker shows where the money and the ticket are at every moment. Users never see crypto: they log in with email or Google, see prices in dollars (devnet USDC), and a relayer pays gas.

Built for the UBC 2026 Hackathon. **Submission due Fri Nov 20, 12 PM CST.**

## Repo layout

```
program/     Anchor workspace (program: seatsafe)            owner A
app/         Next.js app (App Router, TypeScript)
  app/         routes (see CONTRIBUTING.md for who owns which)
    api/         API routes                                     owner B
  components/  shared UI (components/ui = shadcn/ui)
  lib/         types.ts, mock.ts, hooks.ts, privy.tsx, solana.ts, supabase.ts, format.ts
    idl/         generated program IDL + TS types (copied by `npm run sync-idl`)
supabase/    schema.sql and seed.sql                          owner B
docs/        longer docs (later)
```

`app/lib/types.ts` is the contract the whole team codes against. UI gets data only through `useEvents()` / `useOrder()` in `app/lib/hooks.ts`.

## Prerequisites

| Tool | Version used | Needed for |
| --- | --- | --- |
| Node.js | 20+ (built with 24.14.0) | app |
| npm | 11.9.0 | app |
| Rust | 1.100.0 (program pins 1.89.0 via `program/rust-toolchain.toml`) | program |
| Solana CLI (Agave) | 4.3.2 | program |
| Anchor CLI (via avm) | 1.2.2 | program |
| Surfpool | optional | default validator for `anchor test` in Anchor 1.x |

Frontend-only teammates need **only Node 20+**. Solana tooling install guide: https://solana.com/docs/intro/installation

## Run the app with mocks (no keys needed)

```bash
cd app
npm install
npm run dev        # http://localhost:3000
```

With no env vars the app uses mock data, login is disabled (a banner says so), and Supabase is `null`.

Try these pages:
- `/` Discover (event grid)
- `/orders/ord_held`, `/orders/ord_transit`, `/orders/ord_released` (order tracker with simulate buttons)
- `/agent`, `/tickets`, `/sell`, `/creator`
- `/api/health`

Other app scripts: `npm run lint`, `npm run build`.

## Environment variables

Copy `app/.env.example` to `app/.env.local` and fill in what you have. Never commit `.env.local`.

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_USE_MOCK` | `true` | Anything but `"false"` means mock data |
| `NEXT_PUBLIC_PRIVY_APP_ID` | empty | Empty means login disabled |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Devnet RPC |
| `NEXT_PUBLIC_USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Circle devnet USDC; verify at https://developers.circle.com |
| `NEXT_PUBLIC_PROGRAM_ID` | empty | SeatSafe program ID (below) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | empty | From B |
| `SUPABASE_SERVICE_ROLE_KEY` | empty | Server only |
| `RELAYER_SECRET_KEY` | empty | Server only; relayer pays gas |

## Program: build, test, deploy

```bash
cd program
npm install                      # once, for the TypeScript tests
anchor build
npm test                         # = anchor test --validator legacy (uses solana-test-validator)
# or plain `anchor test` once Surfpool is installed (Anchor 1.x default validator)
npm run sync-idl                 # copy target/idl + target/types into app/lib/idl/ after every build
```

Deploy to devnet (deployer = `~/.config/solana/id.json`):

```bash
solana config set --url devnet
solana airdrop 2                 # or https://faucet.solana.com if rate limited
anchor deploy --provider.cluster devnet
```

`Anchor.toml` has the same program ID under `[programs.localnet]` and `[programs.devnet]`. After changing the program keypair, run `anchor keys sync`.

Keypairs live outside git: deployer in `~/.config/solana/id.json`, relayer and arbiter in `.keys/` at the repo root (git-ignored). Ask A for them; never commit or paste secret keys.

## Deployed addresses (devnet)

| What | Address |
| --- | --- |
| SeatSafe program | `7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy` (**not yet deployed**: deployer needs devnet SOL) |
| USDC mint (Circle devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Deployer | `2VHBVmwU6C5NLdKjpykvJdGYWoSUw5uHAq3EKTbLHTqv` |
| Relayer | `7r2SszeUx3xyJsjAeUYvveMMmvkjjvxbPhxUGiP78g61` |
| Arbiter | `5AFvU5Cyxy6bUMbhumhmeJeRLbNxPjgr8bqKXENxnbjr` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, PRs, file ownership and deadlines.
