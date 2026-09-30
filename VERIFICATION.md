# A2A Server Verification Report

**Target:** `~/workspace/a2a-agent-server/` (read-only review — no code changed)
**Live deployment:** `https://a2a-agent-server-johnnyc.vercel.app`
**Date:** 2026-09-30 ~11:05 CDT
**Spec:** A2A Protocol v1.0.0 (https://a2a-protocol.org/latest/specification/ — latest released; previous: 0.3.0)
**SDK:** `@a2a-js/sdk@1.3.0` (confirmed latest on npm registry — this is Johnny's "official SDK v1.3.0")

## Verdict: CONDITIONAL FAIL

The server is a **correct, well-built A2A v0.3-dialect** implementation, but the agent card
**advertises protocolVersion "1.0"** while the wire speaks the old dialect. The official
SDK v1.3.0 client **cannot interoperate** with this deployment as advertised. The JSON-RPC
envelope mechanics themselves are solid.

---

## Check 1 — Agent Card schema: PASS (with deviations)

`GET /.well-known/agent.json` → HTTP 200, valid JSON.

Required v1.0 fields (§4.4.1), all present:
- `name`: "Bot" ✓
- `description` ✓
- `supportedInterfaces`: `[{url, protocolBinding, protocolVersion}]` ✓ (first entry preferred ✓)
- `version`: "1.0.0" ✓
- `capabilities`: `{streaming, pushNotifications}` ✓
- `defaultInputModes` / `defaultOutputModes` ✓ present
- `skills`: 5 entries, each with required `id`/`name`/`description`/`tags` ✓
- No `securitySchemes`/`securityRequirements` = no auth required. Correct for a public endpoint ✓
- Discovery path `/.well-known/agent.json` ✓ (canonical; `agent-card.json` was only the RC name)

Deviations:
- **MAJOR (M-1):** `supportedInterfaces[0].protocolBinding` is `"HTTP+JSON"`, but the
  endpoint speaks **JSON-RPC 2.0 envelopes** (`{"jsonrpc","id","method","params"}`).
  Per spec §4.4.6 the core bindings are `JSONRPC`, `GRPC`, `HTTP+JSON` — distinct values.
  The SDK's `JsonRpcTransportFactory` matches interfaces via
  `pickMatchingInterface(card, 'JSONRPC', url)` (exact, case-insensitive binding match),
  so it finds **zero** matching interfaces on this card. The REST (`HTTP+JSON`) transport
  would be selected instead, which speaks `POST /message:send` — not JSON-RPC. Either way,
  card-driven discovery picks the wrong transport. File: `lib/a2a.ts`, `buildAgentCard`.
- **MINOR (m-1):** `defaultInputModes`/`defaultOutputModes` are `["text"]`; spec defines
  these as media types (e.g. `"text/plain"`). File: `lib/a2a.ts`, `buildAgentCard`.
- **Cosmetic (c-1):** extra fields not in the v1.0 card schema — top-level `protocolVersion`,
  `contact`, `capabilities.stateTransitionHistory`. Spec §5.7 says implementations SHOULD
  ignore unrecognized fields, so harmless on the wire; the top-level `protocolVersion` is
  misleading (v1.0 moved it per-interface). File: `lib/a2a.ts`, `buildAgentCard`.

## Check 2 — JSON-RPC wire: PASS (v0.3 dialect)

Live tests against `POST /api/a2a`:

| Test | Result |
|---|---|
| `message/send` valid envelope | **PASS** — `{"jsonrpc":"2.0","id":1,"result":{task…}}`, state `completed`, echo text correct, history + artifacts present |
| `message/stream` SSE | **PASS (transport)** — `Content-Type: text/event-stream`; emits `status-update` (working) → `artifact-update` → `status-update` (completed, final) → `done` with full JSON-RPC result. Format is v0.3-style custom events (see M-3) |
| `tasks/get` valid id | **PASS** — returns stored task; `historyLength: 1` correctly truncates history to 1 message |
| `tasks/cancel` on completed task | **PASS** — `-32002` "Task is not cancelable (state: completed)" |
| `tasks/cancel` on unknown id | (implied by get path) `-32001` |
| Successful cancel | **UNTESTABLE** — tasks complete synchronously inside `executeTask`; no non-terminal state is ever reachable, so the cancel-success branch in `handleTasksCancel` (`lib/a2a.ts`) cannot be exercised |

Error codes `-32001`/`-32002` match the spec §5.4 JSON-RPC code mappings exactly.

## Check 3 — SDK v1.3.0 interop: FAIL

Verified against the actual SDK source (`a2aproject/a2a-js`, `src/client/transports/json_rpc_transport.ts`):

- **M-2 — Method names:** SDK sends `SendMessage`, `SendStreamingMessage`, `GetTask`,
  `CancelTask` (spec §5.3). Server only handles `message/send`, `message/stream`,
  `tasks/get`, `tasks/cancel`. Live proof: `SendMessage` → `{"code":-32601,"message":"Method not found: SendMessage"}`.
  File: `app/api/a2a/route.ts`, POST switch.
- **M-3 — Streaming envelope:** SDK `_processSseEventData` requires **every** SSE `data:`
  to be a full JSON-RPC 2.0 response (`{jsonrpc:'2.0', id:<must match request id>, result}`),
  else it throws `Invalid JSON-RPC response for SSE event`. Server sends bare named events
  (`event: status-update`, data `{"taskId":…}` — no `jsonrpc`/`id`). Live stream captured;
  the SDK client would throw on the first event. File: `app/api/a2a/route.ts`, `handleStream`.
- **M-4 — Response shape + enums:** SDK does `SendMessageResponse.fromJSON(result)` then
  requires `response.payload` (`{task:{…}}` or `{message:{…}}` oneof); server returns the
  bare Task → SDK throws `Invalid response: missing payload`. Enums must be ProtoJSON
  SCREAMING_SNAKE (§5.5: `TASK_STATE_COMPLETED`, `ROLE_USER`); server sends lowercase
  `completed`/`working`/`canceled` and `role: "user"`. Files: `lib/a2a.ts` (`TaskState`,
  `A2AMessage`, `executeTask`), `app/api/a2a/route.ts`.
- **M-5 — The compat trap:** the SDK ships a v0.3 `LegacyJsonRpcTransport`, but it engages
  **only** when the client opts into `legacyCompat` AND the card's interface
  `protocolVersion` is in `[0.3, 1.0)`. This card claims `"1.0"` while serving the 0.3
  dialect — the one combination that defeats the compat layer entirely.

Net: `protocolVersion: "1.0"` in the card is the correct *current spec version number*,
but this endpoint does not speak v1.0. An SDK v1.3.0 client doing card-driven
`ClientFactory.createFromUrl(...)` → `sendMessage(...)` fails at transport selection,
method dispatch, response parsing, or streaming — whichever it hits first.

## Check 4 — Error paths: PASS

| Test | Live result |
|---|---|
| Unknown method | `-32601` `Method not found: message/bogus` ✓ |
| Missing `params.message.parts` | `-32602` `message/send requires params.message.parts (array)` ✓ |
| Malformed JSON body | `-32700` `Parse error` (HTTP 400) ✓ |
| Valid JSON, not JSON-RPC (no `jsonrpc`) | `-32600` `Invalid Request` (HTTP 400) ✓ |
| `tasks/get` unknown id | `-32001` `Task not found: …` ✓ |

All errors are JSON bodies with `{"jsonrpc":"2.0","id":…,"error":{"code","message"}}`.
No HTML error pages, no stack traces leaked. `id` is correctly echoed (or `null`).

## Additional finding — production store is ephemeral (M-6)

`server-info` on the **live deployment** reports `store: memory` — the Vercel KV
environment variables (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) are not configured on
the `a2a-agent-server` project, so the `getStore()` fallback is active. On serverless,
each cold start / instance has its own empty store: a `tasks/get` for a task created on
a different instance returns `-32001`. The KV code path (`lib/a2a.ts`, `createKvStore`)
is implemented but unwired in production. Fix: set the KV env vars on the Vercel
project (no paid plan change needed — KV has a free tier), or explicitly accept
ephemeral tasks.

---

## Must-fix list

> **CORRECTION 2026-09-30 (independent re-verification, real @a2a-js/sdk@1.3.0):**
> the original M-4 text above was wrong about the response wrapper. The SDK's
> *generated* `SendMessageResponse.fromJSON` is the authority, not the spec prose:
> proto-JSON oneof members serialize **FLAT**. `{"result":{"payload":{"task":{…}}}}`
> throws `Invalid response: missing payload`; the correct wire shape is
> `{"result":{"task":{…}}}` (and `{"result":{"message":{…}}}` for message
> responses). Same root cause in streaming: the SDK's `StreamResponse.fromJSON`
> reads `object.statusUpdate` / `object.artifactUpdate` FLAT — the `kind`
> discriminator (`status-update`/`artifact-update`) matches nothing and every event
> parsed as `{}`. Correct: `{"result":{"statusUpdate":{taskId,contextId,status}}}`
> and `{"result":{"artifactUpdate":{taskId,contextId,artifact,append,lastChunk}}}`,
> still full JSON-RPC envelopes on every SSE `data:` line with the matching request
> id. Also drop the `final` field — v1.0 `TaskStatusUpdateEvent` has no `final`;
> the terminal signal is `status.state == "TASK_STATE_COMPLETED"`.
> (Fixed in `fix/v1-wire-shapes`.)

1. **(M-1)** `lib/a2a.ts` → `buildAgentCard()`: change
   `supportedInterfaces[0].protocolBinding` from `"HTTP+JSON"` to `"JSONRPC"`.
   The endpoint consumes/produces JSON-RPC 2.0 envelopes — that is the JSONRPC binding.
2. **(M-2/M-3/M-4 — pick one)** Either
   **(a)** implement the v1.0 dialect in `app/api/a2a/route.ts` + `lib/a2a.ts`
   (`SendMessage`/`SendStreamingMessage`/`GetTask`/`CancelTask`/`ListTasks`,
   flat oneof members `{"result":{"task":{…}}}` / `{"result":{"message":{…}}}`,
   `TASK_STATE_*`/`ROLE_*` enums, per-event JSON-RPC SSE envelopes with matching
   `id` carrying flat `result.statusUpdate` / `result.artifactUpdate`, no `kind`,
   no `final`), keeping the card's `"1.0"` claim; **or (b)** honestly advertise
   the 0.3 dialect (`protocolVersion: "0.3"`, binding `"JSONRPC"`) so SDK clients
   with `legacyCompat: {enabled:true}` can connect. (a) is the real fix;
   (b) is a stopgap. **See the CORRECTION above — the original `{payload:{…}}`
   wrapper in this item was wrong.**
3. **(M-6)** Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` on the Vercel project
   `a2a-agent-server`, or document that tasks are ephemeral per instance.
4. **(m-1)** `lib/a2a.ts` → `buildAgentCard()`: `defaultInputModes`/`defaultOutputModes`
   should be media types (`"text/plain"`), not `"text"`.
5. **(c-1)** Consider dropping non-schema extras (`contact`, top-level
   `protocolVersion`, `capabilities.stateTransitionHistory`) to avoid misleading
   strict clients.

## What is genuinely good

- JSON-RPC 2.0 envelope discipline is correct: `-32700`/`-32600`/`-32601`/`-32602`
  all fire in the right conditions with the `id` echoed properly; no HTML/stack leaks.
- Spec error-code mappings `-32001` (not found) / `-32002` (not cancelable) are right.
- `tasks/get` honors `historyLength`.
- SSE transport works end-to-end (headers, event flow, clean close) — only the
  event *payload contract* is v0.3-era.
- The Task shape (id/contextId/status/history/artifacts) is structurally sound;
  only enum casing and the response wrapper differ from v1.0.
- `TaskStore` abstraction with KV/memory fallback is the right design — it just
  isn't configured in production.
