/**
 * A2A protocol v1.0 — minimal wire types, agent card builder, task store,
 * built-in skills, and task execution. JSON-RPC 2.0 transport lives in the
 * API route; this module is transport-agnostic.
 */

// ---------------------------------------------------------------------------
// Wire types (A2A v1.0, minimal but protocol-faithful)
// ---------------------------------------------------------------------------

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

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
  messageId: string;
  role: 'user' | 'agent';
  parts: Part[];
  contextId?: string;
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
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: A2AMessage[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

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
    protocolVersion: '1.0',
    provider: {
      organization: 'johnnyc',
      url: base,
    },
    contact: {
      email: 'foundit@agentmail.to',
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: CARD_SKILLS,
    // No `authentication` field: this endpoint requires no credentials.
    supportedInterfaces: [
      {
        protocolBinding: 'HTTP+JSON',
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
  kind: 'memory' | 'vercel-kv';
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

async function createKvStore(): Promise<TaskStore> {
  // Dynamic import so the module is only loaded when KV is actually configured.
  const { kv } = await import('@vercel/kv');
  const TASK_KEY = (id: string) => `a2a:task:${id}`;
  const INDEX_KEY = 'a2a:task-index';
  return {
    kind: 'vercel-kv',
    async save(t: StoredTask): Promise<void> {
      await kv.set(TASK_KEY(t.task.id), t);
      await kv.lpush(INDEX_KEY, t.task.id);
      await kv.ltrim(INDEX_KEY, 0, 499);
    },
    async get(id: string): Promise<StoredTask | null> {
      return (await kv.get<StoredTask>(TASK_KEY(id))) ?? null;
    },
    async list(limit: number): Promise<StoredTask[]> {
      const ids = await kv.lrange<string>(INDEX_KEY, 0, limit - 1);
      const seen = new Set<string>();
      const unique = ids
        .filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .slice(0, limit);
      if (unique.length === 0) return [];
      const rows = await kv.mget<StoredTask[]>(...unique.map(TASK_KEY));
      return rows.filter((r): r is StoredTask => r !== null);
    },
  };
}

let kvStorePromise: Promise<TaskStore> | null = null;
let memoryStore: MemoryTaskStore | null = null;

/** Vercel KV when configured, in-memory otherwise. */
export function getStore(): Promise<TaskStore> {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    if (!kvStorePromise) kvStorePromise = createKvStore();
    return kvStorePromise;
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
          `protocol: A2A ${card.protocolVersion} over HTTP+JSON`,
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
// Task execution (shared by message/send and message/stream)
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

const TERMINAL_STATES: TaskState[] = ['completed', 'canceled', 'failed', 'rejected'];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

export async function executeTask(params: SendMessageParams): Promise<{
  working: A2ATask;
  completed: A2ATask;
}> {
  const msg = params.message;
  if (!msg || !Array.isArray(msg.parts)) {
    throw new RpcError(-32602, 'message/send requires params.message.parts (array)');
  }
  const store = await getStore();
  const taskId = crypto.randomUUID();
  const contextId = msg.contextId || crypto.randomUUID();
  const userMessage: A2AMessage = {
    messageId: msg.messageId || crypto.randomUUID(),
    role: 'user',
    parts: msg.parts,
    contextId,
  };
  const now = () => new Date().toISOString();
  const working: A2ATask = {
    id: taskId,
    contextId,
    status: { state: 'working', timestamp: now() },
    history: [userMessage],
  };
  await store.save({ task: working, updatedAt: now() });

  const text = extractText(msg.parts);
  const { command, arg } = routeCommand(text);
  const result = await runSkill(command, arg, store);
  const agentMessage: A2AMessage = {
    messageId: crypto.randomUUID(),
    role: 'agent',
    parts: [{ kind: 'text', text: result.text }],
    contextId,
  };
  const completed: A2ATask = {
    ...working,
    status: { state: 'completed', timestamp: now() },
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
    throw new RpcError(-32602, 'tasks/get requires params.id (string)');
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
    throw new RpcError(-32602, 'tasks/cancel requires params.id (string)');
  }
  const store = await getStore();
  const stored = await store.get(p.id);
  if (!stored) throw new RpcError(-32001, `Task not found: ${p.id}`);
  if (isTerminal(stored.task.status.state)) {
    throw new RpcError(-32002, `Task is not cancelable (state: ${stored.task.status.state})`);
  }
  const canceled: A2ATask = {
    ...stored.task,
    status: { state: 'canceled', timestamp: new Date().toISOString() },
  };
  await store.save({ task: canceled, updatedAt: new Date().toISOString() });
  return canceled;
}
