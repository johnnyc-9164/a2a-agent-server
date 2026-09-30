/**
 * A2A protocol v1.0 — wire types, agent card builder, task store, built-in
 * skills, and task execution. JSON-RPC 2.0 transport lives in the API route;
 * this module is transport-agnostic.
 *
 * v1.0 dialect notes (spec a2a-protocol.org v1.0.0):
 * - Method names: SendMessage, SendStreamingMessage, GetTask, CancelTask, ListTasks
 *   (legacy v0.3 aliases are accepted by the route but respond in v1.0 shapes).
 * - SendMessage response: { task } or { message } — proto-JSON oneof members
 *   serialize FLAT (SendMessageResponse.fromJSON reads object.task/object.message);
 *   there is NO `payload` wrapper. Verified against @a2a-js/sdk@1.3.0.
 * - Streaming: each SSE data line is a JSON-RPC response whose result carries
 *   the flat oneof member: { statusUpdate: {...} } / { artifactUpdate: {...} }.
 *   No `kind` discriminator, no `final` flag — the terminal signal is
 *   status.state == "TASK_STATE_COMPLETED".
 * - Enums are ProtoJSON SCREAMING_SNAKE: TASK_STATE_*, ROLE_*.
 * - Message and Task carry a `kind` discriminator ("message" / "task").
 */

// ---------------------------------------------------------------------------
// Wire types (A2A v1.0)
// ---------------------------------------------------------------------------

export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_UNKNOWN';

export type Role = 'ROLE_USER' | 'ROLE_AGENT';

export interface TextPart {
  kind: 'text';
  text: string;
  metadata?: Record<string, unknown>;
}

export interface DataPart {
  kind: 'data';
  data: unknown;
  metadata?: Record<string, unknown>;
}

export type Part = TextPart | DataPart;

export interface A2AMessage {
  kind: 'message';
  messageId: string;
  role: Role;
  parts: Part[];
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  timestamp: string;
  message?: A2AMessage;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface A2ATask {
  kind: 'task';
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: A2AMessage[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// v1.0 streaming event shapes (each rides inside a JSON-RPC response on the
// wire as result.statusUpdate / result.artifactUpdate — flat oneof members,
// no `kind` discriminator, no `final` flag)
// ---------------------------------------------------------------------------

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: TaskStatus;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append: boolean;
  lastChunk: boolean;
}

export type SendMessageEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 envelope
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

export function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

export interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

const CARD_SKILLS: AgentCardSkill[] = [
  {
    id: 'deep-research',
    name: 'Deep research',
    description:
      'Multi-source web research with verified citations — markets, products, technical topics.',
    tags: ['research', 'web', 'analysis'],
  },
  {
    id: 'build-web',
    name: 'Build web artifacts',
    description:
      'Design and build web apps, sites, documents, and interactive pages; Next.js/Vercel-oriented.',
    tags: ['web', 'nextjs', 'vercel', 'frontend'],
  },
  {
    id: 'agent-infrastructure',
    name: 'Agent infrastructure design',
    description:
      'Execution contracts, eval harnesses, capability leases, and verification layers for production AI agents.',
    tags: ['ai-agents', 'evals', 'reliability'],
  },
  {
    id: 'automation',
    name: 'Automation and integrations',
    description:
      'Scheduled jobs, event-driven workflows, and integrations across email, calendar, and web services.',
    tags: ['automation', 'scheduling', 'integrations'],
  },
  {
    id: 'writing',
    name: 'Writing and documents',
    description:
      'Proposals, profiles, cold outreach, documentation — drafted ready to send.',
    tags: ['writing', 'copywriting', 'docs'],
  },
];

/** Resolve the public base URL: env first, then the request origin. Never hardcoded. */
export function resolveBaseUrl(requestOrigin?: string): string {
  const raw = process.env.PUBLIC_BASE_URL || requestOrigin || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

export function buildAgentCard(requestOrigin?: string) {
  const base = resolveBaseUrl(requestOrigin);
  return {
    name: 'Bot',
    description:
      'Personal AI assistant and builder agent. Handles research, writing, coding, and automation — from deep-dive investigations and data artifacts to shipping Next.js/Vercel web apps. Specializes in production-grade AI agent infrastructure: execution contracts, eval harnesses, and verification layers that keep agents reliable past the demo.',
    version: '1.0.0',
    provider: {
      organization: 'johnnyc',
      url: base,
    },
    // No `authentication` field: this endpoint requires no credentials.
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: CARD_SKILLS,
    supportedInterfaces: [
      {
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        url: `${base}/api/a2a`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Task store
// ---------------------------------------------------------------------------

export interface StoredTask {
  task: A2ATask;
  updatedAt: string;
}

export interface TaskStore {
  kind: 'memory' | 'blob';
  save(t: StoredTask): Promise<void>;
  get(id: string): Promise<StoredTask | null>;
  list(limit: number): Promise<StoredTask[]>;
}

class MemoryTaskStore implements TaskStore {
  readonly kind = 'memory' as const;
  private tasks = new Map<string, StoredTask>();
  private order: string[] = [];

  async save(t: StoredTask): Promise<void> {
    if (!this.tasks.has(t.task.id)) this.order.unshift(t.task.id);
    this.tasks.set(t.task.id, t);
  }

  async get(id: string): Promise<StoredTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async list(limit: number): Promise<StoredTask[]> {
    const out: StoredTask[] = [];
    const seen = new Set<string>();
    for (const id of this.order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const t = this.tasks.get(id);
      if (t) out.push(t);
      if (out.length >= limit) break;
    }
    return out;
  }
}

async function createBlobStore(): Promise<TaskStore> {
  // Dynamic import so the module is only loaded when Blob is actually configured.
  // The store is PRIVATE, so @vercel/blob >= 2.3 private-storage APIs are used:
  // put(..., { access: 'private' }) and get(pathname, { access: 'private' }).
  // `access` is per-blob, never inferred from the store — 'public' is rejected
  // by the API against a private store (that was the production -32603).
  const { put, list, get } = await import('@vercel/blob');
  const token = process.env.BLOB_READ_WRITE_TOKEN!;
  const PREFIX = 'tasks/';
  const PATH = (id: string) => `${PREFIX}${id}.json`;

  async function readStored(pathname: string): Promise<StoredTask | null> {
    try {
      const res = await get(pathname, { access: 'private', token });
      // get() returns null on 404; a 304 has no stream.
      if (!res || !res.stream) return null;
      const text = await new Response(res.stream as ReadableStream).text();
      return JSON.parse(text) as StoredTask;
    } catch {
      return null;
    }
  }

  return {
    kind: 'blob',
    async save(t: StoredTask): Promise<void> {
      await put(PATH(t.task.id), JSON.stringify(t), {
        token,
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        // Tasks are saved twice (working -> completed) under one pathname.
        allowOverwrite: true,
      });
    },
    async get(id: string): Promise<StoredTask | null> {
      return readStored(PATH(id));
    },
    async list(limit: number): Promise<StoredTask[]> {
      const seen = new Set<string>();
      const collected: { uploadedAt: number; pathname: string }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({
          token,
          prefix: PREFIX,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const b of page.blobs) {
          if (!b.pathname.startsWith(PREFIX) || seen.has(b.pathname)) continue;
          seen.add(b.pathname);
          collected.push({
            uploadedAt: new Date(b.uploadedAt).getTime(),
            pathname: b.pathname,
          });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor && collected.length < 500);
      collected.sort((a, b) => b.uploadedAt - a.uploadedAt);
      const rows = await Promise.all(
        collected.slice(0, Math.min(limit, 500)).map((c) => readStored(c.pathname)),
      );
      return rows.filter((r): r is StoredTask => r !== null);
    },
  };
}

let blobStorePromise: Promise<TaskStore> | null = null;
let memoryStore: MemoryTaskStore | null = null;

/** Vercel Blob when configured, in-memory otherwise. */
export function getStore(): Promise<TaskStore> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    if (!blobStorePromise) blobStorePromise = createBlobStore();
    return blobStorePromise;
  }
  if (!memoryStore) memoryStore = new MemoryTaskStore();
  return Promise.resolve(memoryStore);
}

// ---------------------------------------------------------------------------
// Built-in skills
// ---------------------------------------------------------------------------

export interface SkillResult {
  name: string;
  text: string;
}

export function routeCommand(text: string): { command: string; arg: string } {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (lower.startsWith('/echo')) return { command: 'echo', arg: t.slice(5).trim() };
  if (lower.startsWith('echo:')) return { command: 'echo', arg: t.slice(5).trim() };
  if (lower === '/info' || lower === 'info' || lower === 'server-info' || lower === '/server-info')
    return { command: 'server-info', arg: '' };
  if (lower === '/history' || lower === 'history' || lower === 'task-history')
    return { command: 'task-history', arg: '' };
  return { command: 'echo', arg: t };
}

export async function runSkill(
  command: string,
  arg: string,
  store: TaskStore,
): Promise<SkillResult> {
  switch (command) {
    case 'server-info': {
      const card = buildAgentCard();
      return {
        name: 'server-info',
        text: [
          `Bot A2A server`,
          `name: ${card.name}`,
          `version: ${card.version}`,
          `protocol: A2A 1.0 over JSON-RPC`,
          `store: ${store.kind}`,
          `uptime: ${Math.floor(process.uptime())}s`,
          `skills: echo, server-info, task-history`,
        ].join('\n'),
      };
    }
    case 'task-history': {
      const recent = await store.list(10);
      if (recent.length === 0) return { name: 'task-history', text: 'No tasks recorded yet.' };
      const lines = recent.map(
        (s) => `- ${s.task.id} [${s.task.status.state}] ${s.task.status.timestamp}`,
      );
      return { name: 'task-history', text: `Recent tasks:\n${lines.join('\n')}` };
    }
    case 'echo':
    default:
      return { name: 'echo', text: arg };
  }
}

// ---------------------------------------------------------------------------
// Task execution (shared by SendMessage and SendStreamingMessage)
// ---------------------------------------------------------------------------

export interface SendMessageParams {
  message?: {
    messageId?: string;
    role?: string;
    contextId?: string;
    parts?: Part[];
  };
  configuration?: {
    historyLength?: number;
  };
}

function extractText(parts: Part[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'object' || p === null) continue;
    const part = p as { kind?: unknown; text?: unknown };
    // Accept both the TS convenience shape { kind: 'text', text } and the
    // canonical proto-JSON oneof member { text: '...' } that the official
    // SDK actually sends on the wire (no `kind` discriminator).
    if (typeof part.text === 'string' && (part.kind === undefined || part.kind === 'text')) {
      out.push(part.text);
    }
  }
  return out.join('\n');
}

const TERMINAL_STATES: TaskState[] = [
  'TASK_STATE_COMPLETED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_FAILED',
  'TASK_STATE_REJECTED',
];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

export async function executeTask(params: SendMessageParams): Promise<{
  working: A2ATask;
  completed: A2ATask;
}> {
  const msg = params.message;
  if (!msg || !Array.isArray(msg.parts)) {
    throw new RpcError(-32602, 'SendMessage requires params.message.parts (array)');
  }
  const store = await getStore();
  const taskId = crypto.randomUUID();
  const contextId = msg.contextId || crypto.randomUUID();
  const userMessage: A2AMessage = {
    kind: 'message',
    messageId: msg.messageId || crypto.randomUUID(),
    role: 'ROLE_USER',
    parts: msg.parts,
    contextId,
  };
  const now = () => new Date().toISOString();
  const working: A2ATask = {
    kind: 'task',
    id: taskId,
    contextId,
    status: { state: 'TASK_STATE_WORKING', timestamp: now() },
    history: [userMessage],
  };
  await store.save({ task: working, updatedAt: now() });

  const text = extractText(msg.parts);
  const { command, arg } = routeCommand(text);
  const result = await runSkill(command, arg, store);
  const agentMessage: A2AMessage = {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'ROLE_AGENT',
    parts: [{ kind: 'text', text: result.text }],
    contextId,
  };
  const completed: A2ATask = {
    ...working,
    status: {
      state: 'TASK_STATE_COMPLETED',
      timestamp: now(),
      message: agentMessage,
    },
    history: [userMessage, agentMessage],
    artifacts: [
      {
        artifactId: crypto.randomUUID(),
        name: result.name,
        parts: [{ kind: 'text', text: result.text }],
      },
    ],
  };
  await store.save({ task: completed, updatedAt: now() });
  return { working, completed };
}

export async function handleTasksGet(params: unknown): Promise<A2ATask> {
  const p = (params ?? {}) as { id?: string; historyLength?: number };
  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new RpcError(-32602, 'GetTask requires params.id (string)');
  }
  const store = await getStore();
  const stored = await store.get(p.id);
  if (!stored) throw new RpcError(-32001, `Task not found: ${p.id}`);
  const task = stored.task;
  if (typeof p.historyLength === 'number' && task.history) {
    return { ...task, history: task.history.slice(-p.historyLength) };
  }
  return task;
}

export async function handleTasksCancel(params: unknown): Promise<A2ATask> {
  const p = (params ?? {}) as { id?: string };
  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new RpcError(-32602, 'CancelTask requires params.id (string)');
  }
  const store = await getStore();
  const stored = await store.get(p.id);
  if (!stored) throw new RpcError(-32001, `Task not found: ${p.id}`);
  if (isTerminal(stored.task.status.state)) {
    throw new RpcError(-32002, `Task is not cancelable (state: ${stored.task.status.state})`);
  }
  const canceled: A2ATask = {
    ...stored.task,
    status: { state: 'TASK_STATE_CANCELED', timestamp: new Date().toISOString() },
  };
  await store.save({ task: canceled, updatedAt: new Date().toISOString() });
  return canceled;
}

export async function handleListTasks(params: unknown): Promise<A2ATask[]> {
  const p = (params ?? {}) as { limit?: number };
  const limit =
    typeof p.limit === 'number' && p.limit > 0 ? Math.min(Math.floor(p.limit), 100) : 20;
  const store = await getStore();
  const rows = await store.list(limit);
  return rows.map((s) => s.task);
}
