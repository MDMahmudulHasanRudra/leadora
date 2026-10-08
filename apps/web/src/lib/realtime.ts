'use client';

import { useEffect, useRef } from 'react';

export interface RealtimeMessage {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Subscribes to /api/v1/realtime (same origin; Caddy proxies the upgrade). Reconnects with backoff.
 * Events are hints to refetch: the server state is always the source of truth.
 */
export function useRealtime(onEvent: (event: RealtimeMessage) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/realtime`;
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as RealtimeMessage;
          if (msg.type === 'ready') attempt = 0;
          handler.current(msg);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = (e) => {
        if (stopped || e.code === 4401 || e.code === 4403) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);
}
