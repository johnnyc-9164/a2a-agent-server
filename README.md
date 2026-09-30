# a2a-agent-server

A2A protocol v1.0 server for the **Bot** agent card. Next.js App Router + TypeScript (strict).

## What it serves

- `GET /.well-known/agent.json` — the Bot agent card. `PUBLIC_BASE_URL` (env) sets
  the public URL; local dev falls back to the request origin. No `authentication`
  field is advertised (none required).
- `POST /api/a2a` — JSON-RPC 2.0 endpoint (A2A v1.0):
  - `message/send` — executes a built-in skill, returns a completed `Task`
  - `message/stream` — same, streamed as Server-Sent Events
    (`status-update` → `artifact-update` → `status-update` final → `done`)
  - `tasks/get` — fetch a task by id (optional `historyLength`)
  - `tasks/cancel` — cancel a non-terminal task

Task storage: `TaskStore` interface with two implementations — **Vercel KV**
(`@vercel/kv`, selected when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set)
for production, **in-memory** fallback for local dev.

Built-in skills (so `message/send` completes honestly):

- `/echo <text>` — returns the input text
- `/info` — card summary, store backend, uptime
- `/history` — recent task ids and states

## Run locally

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm typecheck  # tsc --noEmit
pnpm build      # production build
```

Copy `.env.example` to `.env.local` and set `PUBLIC_BASE_URL` to preview the
production card values.

## Quick verification

```bash
# agent card
curl -s http://localhost:3000/.well-known/agent.json | head -c 400

# message/send
curl -s -X POST http://localhost:3000/api/a2a \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"/echo hello a2a"}]}}}'

# stream
curl -N -X POST http://localhost:3000/api/a2a \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"/info"}]}}}'
```

## Notes

- Phase 1: local skills only. Real agent execution (routing tasks to workers) is a
  later phase.
- No secrets in code; configuration is env-only. No emoji anywhere.
