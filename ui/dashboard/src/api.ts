import type { DashboardStatus, SseEvent } from './types.js';

function getToken(): string | null {
  try {
    return localStorage.getItem('eggshellToken');
  } catch {
    return null;
  }
}

function buildHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token !== null && token.length > 0) {
    headers['x-dashboard-token'] = token;
  }
  return headers;
}

export async function getStatus(): Promise<DashboardStatus> {
  const response = await fetch('/api/status', {
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch status: ${response.status}`);
  }
  return (await response.json()) as DashboardStatus;
}

export async function post<T = unknown>(action: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Action ${action} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function openLogStream(
  onEvent: (event: SseEvent) => void,
  onError?: (event: Event) => void,
  onOpen?: () => void
): EventSource {
  const token = getToken();
  const url = token ? `/api/logs-stream?token=${encodeURIComponent(token)}` : '/api/logs-stream';
  const source = new EventSource(url);

  source.onmessage = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as SseEvent;
      onEvent(data);
    } catch {
      // Ignore unparseable
    }
  };

  if (onError) {
    source.onerror = onError;
  }
  if (onOpen) {
    source.onopen = onOpen;
  }

  return source;
}
