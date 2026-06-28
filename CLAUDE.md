# Claude: start here

**Read [`STATUS.md`](./STATUS.md) first.** It's the living handoff — project goal, current prod/beta state, the bento UI design system, deployment facts, and how to continue the polish loop. (On a fresh machine there is no local Claude memory; `STATUS.md` is the source of truth.)

## Non-negotiable rules
1. **Work on the `beta` branch only. Never merge to `main`/prod without Joe's explicit OK.**
2. **Never commit or push secrets** (keys/tokens/PII). The OpenAI key stays in a gitignored `.env`.
3. Keep beta green: `npm run -w @trove/web build` before every commit.
4. `apps/web` is **NOT vanilla Next.js** — read `apps/web/AGENTS.md` before editing it.

TROVE is a streaming-first shared-world market game. Active work = the bento UI polish loop on `beta` (see STATUS.md for what's done and what's next).
