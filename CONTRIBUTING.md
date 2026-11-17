# Contributing to SeatSafe

## Deadlines (CST)

- **Feature freeze: Thu Nov 19, 12 PM CST.** After that, only bug fixes and demo polish.
- **Submission: Fri Nov 20, 12 PM CST.**

## Workflow

1. Branch from `main` with the name `name/feature`, e.g. `sam/escrow-tracker`.
2. Keep PRs small and focused. Open them into `main`. **A reviews every PR.**
3. Before opening a PR, run in `app/`: `npm run lint` and `npm run build`. Both must pass.
4. Never push directly to `main`.

## Rules

- **Never commit keys.** No `.env.local`, no keypair JSON, no secret keys in code, issues or chat. `.keys/`, `.env*` (except `.env.example`) and `*-keypair.json` are git-ignored; don't force-add them.
- **Build against mocks first.** The app runs with zero env vars. Get your UI working with `lib/mock.ts` data through `useEvents()` / `useOrder()`, then B swaps in Supabase behind the same hooks.
- **`app/lib/types.ts` is the contract.** Don't change it without A's OK; if you need a new field, ask first.
- Get data only through hooks in `app/lib/hooks.ts`. Don't import `lib/mock.ts` directly in new UI (A's placeholder pages do this for now).
- Status colors are theme tokens: `vault` (blue, escrow/held), `released` (green, released/refunded), `transit` (amber, in transit), `disputed` (red). Use them as Tailwind classes, e.g. `text-vault`, `bg-released/15`.
- Animations: `import { motion } from "motion/react"`.
- shadcn/ui components are in `app/components/ui` (Base UI flavor: use the `render` prop where Radix used `asChild`).
- Dynamic routes must keep URL-dependent parts inside `<Suspense>` (Cache Components is on). See `app/app/orders/[id]/page.tsx`.

## File ownership

| Route | File | Owner |
| --- | --- | --- |
| `/` | `app/app/page.tsx` | D |
| `/events/[id]` | `app/app/events/[id]/page.tsx` | A |
| `/orders/[id]` | `app/app/orders/[id]/page.tsx` (+ `OrderTracker.tsx`) | D |
| `/tickets` | `app/app/tickets/page.tsx` | A |
| `/tickets/[id]/pass` | `app/app/tickets/[id]/pass/page.tsx` | D |
| `/sell` | `app/app/sell/page.tsx` | A |
| `/agent` | `app/app/agent/page.tsx` | D |
| `/creator` | `app/app/creator/page.tsx` | A |
| `/api/*` (incl. `/api/health`) | `app/app/api/` | B |

| Other | Owner |
| --- | --- |
| `program/` (Anchor program) | A |
| `supabase/` (schema, seed), real hook implementations (`TODO(B)` in `app/lib/hooks.ts`) | B |
| `app/components/OrderChat.tsx`, `app/components/VoiceApproval.tsx` (ElevenLabs) | D |
| `app/lib/types.ts`, shared layout/nav | A |

C owns no code files: C runs the pitch, Devpost page and demo video.
