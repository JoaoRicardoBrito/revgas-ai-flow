export interface Profile {
  label: string;
  phone: string;
}

export interface Button {
  id: string;
  label: string;
}

export interface Reply {
  text: string;
  buttons?: Button[];
  presentation?: 'buttons' | 'list';
}

export interface Answer {
  conversationId: string;
  step: string;
  replies: Reply[];
  /** Com atendente: o bot não responde. */
  silenced: boolean;
}

export type Outgoing = { text: string } | { buttonId: string };

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const response = await request('/simulator/profiles');
  const profiles: Profile[] = await response.json();
  return profiles;
}

export async function sendMessage(
  phone: string,
  message: Outgoing,
): Promise<Answer> {
  const response = await request('/simulator/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone,
      messageId: crypto.randomUUID(),
      ...message,
    }),
  });
  const answer: Answer = await response.json();
  return answer;
}

/** Resposta de `GET /metrics` (issue #15). */
export interface OrderTiming {
  conversationId: string;
  outcome: string;
  firstMessageAt: string;
  turns: number;
  totalMs: number | null;
  llmMs: number;
  revgasMs: number;
}

export interface Metrics {
  baselineMs: number;
  summary: { sales: number; averageTotalMs: number | null };
  orders: OrderTiming[];
}

export async function fetchMetrics(): Promise<Metrics> {
  const response = await request('/metrics?limit=20');
  const metrics: Metrics = await response.json();
  return metrics;
}
