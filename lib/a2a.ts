/**
 * A2A protocol v1.0 — wire types, agent card builder, task store, built-in
 * skills, and task execution. JSON-RPC 2.0 transport lives in the API route;
 * this module is transport-agnostic.
 *
 * v1.0 dialect notes (spec a2a-protocol.org v1.0.0):
 * - Method names: SendMessage, SendStreamingMessage, GetTask, CancelTask, ListTasks
 *   (legacy v0.3 aliases are accepted by the route but respond in v1.0 shapes).
 * - SendMessage response: { payload: { task } } or { payload: { message } }.
 * - Enums are ProtoJSON SCREAMING_SNAKE: TASK_STATE_*, ROLE_*.
 * - Message and Task carry a `kind` discriminator ("message" / "task").
 * - Streaming events are full JSON-RPC responses per SSE data line.
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
// v1.0 streaming event types (each rides inside a JSON-RPC response on the wire)
// ---------------------------------------------------------------------------

export interface TaskStatusUpdateEvent {
  kind: 'status-update';
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean;
}

export interface TaskArtifactUpdateEvent {
  kind: 'artifact-update';
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
  kind: 'memory' | 'upstash';
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

async function createRedisStore(): Promise<TaskStore> {
  // Dynamic import so the module is only loaded when Redis is actually configured.
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const TASK_KEY = (id: string) => `a2a:task:${id}`;
  const INDEX_KEY = 'a2a:task-index';
  return {
    kind: 'upstash',
    async save(t: StoredTask): Promise<void> {
      await redis.set(TASK_KEY(t.task.id), t);
      await redis.lpush(INDEX_KEY, t.task.id);
      await redis.ltrim(INDEX_KEY, 0, 499);
    },
    async get(id: string): Promise<StoredTask | null> {
      return (await redis.get<StoredTask>(TASK_KEY(id))) ?? null;
    },
    async list(limit: number): Promise<StoredTask[]> {
      const ids = await redis.lrange<string>(INDEX_KEY, 0, limit - 1);
      const seen = new Set<string>();
      const unique = ids
        .filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, limit);
      if (unique.length === 0) return [];
      const rows = await redis.mget<StoredTask[]>(...unique.map(TASK_KEY));
      return rows.filter((r): r is StoredTask => r !== null);
    },
  };
}

let redisStorePromise: Promise<TaskStore> | null = null;
let memoryStore: MemoryTaskStore | null = null;

/** Upstash Redis when configured, in-memory otherwise. */
export function getStore(): Promise<TaskStore> {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (!redisStorePromise) redisStorePromise = createRedisStore();
    return redisStorePromise;
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
  return parts
    .filter((p): p is TextPart => p.kind === 'text' && typeof (p as TextPart).text === 'string')
    .map((p) => p.text)
    .join('\n');
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
