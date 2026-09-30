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
