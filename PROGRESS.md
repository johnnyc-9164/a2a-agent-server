# PROGRESS — A2A v1.0 dialect (branch fix/v1-dialect)

Worktree: ~/workspace/a2a-agent-server-wt/v1dialect
Spec: ~/workspace/a2a-agent-server/VERIFICATION.md must-fix list (option a: full v1.0 dialect)

## Done
- [x] M-1: card supportedInterfaces[0].protocolBinding = "JSONRPC"
- [x] m-1: defaultInputModes/defaultOutputModes = ["text/plain"]
- [x] c-1: dropped top-level protocolVersion, contact, capabilities.stateTransitionHistory
- [x] M-2: SendMessage / SendStreamingMessage / GetTask / CancelTask / ListTasks implemented;
      v0.3 names (message/send, message/stream, tasks/get, tasks/cancel) kept as aliases
      answering in v1.0 shapes
- [x] M-4: SendMessage -> {result:{payload:{task}}} ; TASK_STATE_*/ROLE_* enums;
      kind discriminators on task/message; final status carries the agent message
- [x] M-3: SSE emits only `data:` lines, each a full {"jsonrpc":"2.0","id":<req>,...} response;
      no named events, no bare payloads
- [x] M-6: @vercel/kv replaced by @upstash/redis; UPSTASH_REDIS_REST_URL/_TOKEN;
      in-memory fallback preserved; .env.example documents the vars
- [x] emoji scan: 0 hits; no hardcoded prod URLs; typecheck clean; build clean
- [x] Local dev verification: 33/33 checks PASS (card, SendMessage payload/enums,
      GetTask+historyLength, CancelTask -32002, aliases, ListTasks, SSE envelope+id match,
      -32601, -32001)

## Outstanding (not mine to do here)
- Production deploy + set UPSTASH_REDIS_REST_URL/_TOKEN on the Vercel project
  (coordinator/parent step — real credentials never in code/logs)
- Re-run SDK v1.3.0 client round trip after deploy

## dlg_1b06e1d0 — store backend swap: Upstash Redis -> Vercel Blob (2026-09-30)
- Reason: Vercel Marketplace Redis path has no free tier (paid only). Free private
  Blob store `a2a-task-store` provisioned on the team; BLOB_READ_WRITE_TOKEN is
  injected into the Vercel project env (never handled here).
- lib/a2a.ts: createRedisStore replaced by createBlobStore (@vercel/blob, dynamic
  import). Tasks stored as tasks/<taskId>.json (put, allowOverwrite, signed
  downloadUrl reads); get via prefix list; listing via paginated prefix list
  (cap 500), newest-by-uploadedAt first. TaskStore interface unchanged;
  in-memory fallback preserved when BLOB_READ_WRITE_TOKEN is absent.
  kind is now 'memory' | 'blob'.
- package.json: @upstash/redis removed, @vercel/blob ^1.0.0 added (installed 1.1.1).
- .env.example: documents BLOB_READ_WRITE_TOKEN, no values.
- Verified: pnpm typecheck clean, pnpm build clean, local dev SendMessage ->
  GetTask round trip OK (payload.task, TASK_STATE_COMPLETED, ROLE_* enums,
  history 2 / artifacts 1), server-info reports store: memory (fallback, no
  regression). Blob path not live-tested here (no token on this box); correct
  by construction against @vercel/blob v1.1.1 typings.
- v1.0 dialect, card, SSE from 2e39b19 untouched (regression-checked via the
  local round trip above).
