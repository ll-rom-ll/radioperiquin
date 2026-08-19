export class RealtimeHub {
  constructor({ heartbeatSeconds = 20, maxClients = 2000 } = {}) {
    this.heartbeatSeconds = Math.max(10, Number(heartbeatSeconds) || 20);
    this.maxClients = Math.max(10, Number(maxClients) || 2000);
    this.clients = new Map();
    this.nextClientId = 1;
    this.lastBroadcastAt = '';
    this.totalBroadcasts = 0;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatSeconds * 1000);
    this.heartbeatTimer.unref?.();
  }

  add(req, res, initialConfig) {
    if (this.clients.size >= this.maxClients) return false;
    const id = this.nextClientId++;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n');
    this.writeEvent(res, 'ready', {
      contentVersion: Number(initialConfig?.contentVersion || 0),
      updatedAt: initialConfig?.updatedAt || '',
      transport: 'sse'
    }, initialConfig?.contentVersion);

    const entry = { id, res, connectedAt: Date.now(), remote: req.socket?.remoteAddress || '' };
    this.clients.set(id, entry);
    const cleanup = () => this.clients.delete(id);
    req.once('close', cleanup);
    req.once('aborted', cleanup);
    res.once('close', cleanup);
    res.once('error', cleanup);
    return true;
  }

  writeEvent(res, event, payload, eventId = '') {
    if (eventId !== '' && eventId != null) res.write(`id: ${String(eventId).replace(/[\r\n]/g, '')}\n`);
    res.write(`event: ${String(event).replace(/[\r\n]/g, '')}\n`);
    const data = JSON.stringify(payload ?? {});
    for (const line of data.split(/\r?\n/)) res.write(`data: ${line}\n`);
    res.write('\n');
  }

  broadcastContent(config, reason = 'publish') {
    const payload = {
      contentVersion: Number(config?.contentVersion || 0),
      updatedAt: config?.updatedAt || new Date().toISOString(),
      reason
    };
    let delivered = 0;
    for (const [id, client] of this.clients.entries()) {
      try {
        if (client.res.destroyed || client.res.writableEnded) {
          this.clients.delete(id);
          continue;
        }
        this.writeEvent(client.res, 'content', payload, payload.contentVersion);
        delivered += 1;
      } catch {
        this.clients.delete(id);
        try { client.res.end(); } catch {}
      }
    }
    this.lastBroadcastAt = new Date().toISOString();
    this.totalBroadcasts += 1;
    return delivered;
  }

  heartbeat() {
    const stamp = new Date().toISOString();
    for (const [id, client] of this.clients.entries()) {
      try {
        if (client.res.destroyed || client.res.writableEnded) {
          this.clients.delete(id);
          continue;
        }
        client.res.write(`: ping ${stamp}\n\n`);
      } catch {
        this.clients.delete(id);
        try { client.res.end(); } catch {}
      }
    }
  }

  status() {
    return {
      enabled: true,
      transport: 'sse',
      endpoint: '/api/v1/public/events',
      connectedClients: this.clients.size,
      maxClients: this.maxClients,
      heartbeatSeconds: this.heartbeatSeconds,
      totalBroadcasts: this.totalBroadcasts,
      lastBroadcastAt: this.lastBroadcastAt
    };
  }

  closeAll() {
    clearInterval(this.heartbeatTimer);
    for (const client of this.clients.values()) {
      try {
        this.writeEvent(client.res, 'shutdown', { reconnect: true });
        client.res.end();
      } catch {}
    }
    this.clients.clear();
  }
}
