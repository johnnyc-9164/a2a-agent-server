# PROGRESS — A2A bridge v1 (branch feat/bridge, dlg_5b0098f1)

Worktree: ~/workspace/a2a-agent-server-wt/bridge
Spec: muse-os delegation dlg_5b0098f1 instruction seq 2 (A2A bridge v1 build spec).

## Done (Vercel — Part A)
- [x] `/run <instruction>` intake: routeCommand routes `/run ` to new `runtime-task`
      command; executeTask branches BEFORE any skill runs — submitRuntimeTask
      persists TASK_STATE_SUBMITTED with metadata.bridge={unclaimed:true,
      instruction, submittedAt} to blob exactly like other tasks; the A2A
      response carries a WORKING copy (async pattern). Nothing executes inline.
- [x] Token-gated bridge routes (timing-safe Bearer compare vs BRIDGE_TOKEN;
      401 {error:'unauthorized'}; never logs token values):
      - GET /api/bridge/pending -> {tasks:[{id,submittedAt,instructionPreview}]}, oldest first
      - POST /api/bridge/claim {taskId} -> full claimed task (WORKING, 5-min lease vm-poller), 409 already-claimed
      - POST /api/bridge/complete {taskId,text,artifacts?,state?} -> COMPLETED (or TASK_STATE_FAILED for refused executions), 409 not-claimed / 410 lease-expired
      - Expired leases lazily return to unclaimed on pending/claim reads.
- [x] Agent card gains `runtime-task` skill (read-only v1, refused otherwise).
- [x] Echo/server-info/task-history paths untouched (server-info lists runtime-task).
- [x] SendStreamingMessage for /run: emits one WORKING statusUpdate, closes.
- [x] pnpm run typecheck clean; pnpm run build clean (all routes listed).

## Done (VM — Part B, ~/workspace/a2a-bridge/)
- [x] poller.py (stdlib only): 30s loop pending -> claim oldest -> execute -> complete;
      token from /home/hatch/.config/a2a-bridge/token (0600) in Authorization
      header only, never logged; logs timestamp/taskId/action/outcome only.
- [x] Read-only registry: `http-get <url>` (url must start with the prod base
      URL) and `vercel-read <tool> <json-args>` restricted to
      list_deployments/get_deployment/list_projects via /opt/hatch/bin/vercel.
      Anything else -> task FAILED with "refused: instruction not in the v1
      read-only registry". 60s action timeout, result truncated to 8k.
- [x] a2a-bridge.service (systemd user unit, Restart=always) + install.sh
      (daemon-reload/enable/start; falls back to setsid+PID on hosts with no
      user bus; documents VM-replacement recovery = re-run install.sh).
- [x] README.md: metric/measure/cadence/kill, auth design, approval preservation.

## Verified in production (2026-09-30 ~12:15 CDT) — 5/5 PASS
- 401 on unauthenticated/wrong-token/malformed bridge calls (wrong-length
  token 500'd in timingSafeEqual — fixed by padding buffers, ccaff78).
- SDK `/run http-get <card url>` -> poller claimed/executed/committed;
  GetTask COMPLETED with REAL card JSON (6 skills, org johnnyc).
- SDK `/run do something consequential` -> FAILED with refusal text.
- SDK `/run vercel-read list_projects {}` -> COMPLETED with real data.
- Poller daemon running (~/workspace/a2a-bridge, pid via install.sh);
  complete retries 409/410 with backoff (blob read-after-write window).
- Full proof in VERIFICATION.md "Bridge v1 addendum". Ready for Editor review.
