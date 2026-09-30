export default function Home() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '4rem auto',
        padding: '0 1.5rem',
        lineHeight: 1.6,
      }}
    >
      <h1>Bot — A2A agent server</h1>
      <p>
        Agent-to-Agent (A2A v1.0) JSON-RPC 2.0 endpoint. No authentication required.
      </p>
      <ul>
        <li>
          <a href="/.well-known/agent.json">Agent card</a> (protocol version, skills,
          interface URL)
        </li>
        <li>
          <code>POST /api/a2a</code> — methods: <code>message/send</code>,{' '}
          <code>message/stream</code> (SSE), <code>tasks/get</code>,{' '}
          <code>tasks/cancel</code>
        </li>
      </ul>
      <h2>Built-in skills</h2>
      <ul>
        <li>
          <code>/echo &lt;text&gt;</code> — returns the input text
        </li>
        <li>
          <code>/info</code> — card summary, store backend, uptime
        </li>
        <li>
          <code>/history</code> — recent task ids and states
        </li>
      </ul>
      <p>
        Task persistence: Vercel KV when <code>KV_REST_API_URL</code> and{' '}
        <code>KV_REST_API_TOKEN</code> are set, otherwise in-memory.
      </p>
    </main>
  );
}
