import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bot — A2A agent server',
  description: 'Agent-to-Agent (A2A v1.0) JSON-RPC server for the Bot agent.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
