export class WebsocketHub {
  constructor(log) {
    this.log = log;
    this.clientsByCompany = new Map();
  }

  addClient({ companyId, socket, user }) {
    if (!companyId || !socket) {
      return () => {};
    }

    const entry = { socket, companyId, user };
    const clients = this.clientsByCompany.get(companyId) ?? new Set();
    clients.add(entry);
    this.clientsByCompany.set(companyId, clients);

    this.log.debug({ companyId }, 'WebSocket client connected');

    const cleanup = () => {
      const set = this.clientsByCompany.get(companyId);
      if (!set) return;
      set.delete(entry);
      if (set.size === 0) {
        this.clientsByCompany.delete(companyId);
      }
      this.log.debug({ companyId }, 'WebSocket client disconnected');
    };

    socket.on('close', cleanup);
    socket.on('error', (err) => {
      this.log.warn({ err }, 'WebSocket error');
      cleanup();
    });

    return cleanup;
  }

  broadcast(companyId, payload) {
    const set = this.clientsByCompany.get(companyId);
    if (!set || set.size === 0) {
      return;
    }

    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

    for (const entry of set) {
      const socket = entry.socket;
      if (socket.readyState === socket.OPEN || socket.readyState === 1) {
        try {
          socket.send(message);
        } catch (err) {
          this.log.error({ err }, 'Falha ao enviar mensagem via WebSocket');
        }
      }
    }
  }

  broadcastAll(payload) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const set of this.clientsByCompany.values()) {
      for (const entry of set) {
        const socket = entry.socket;
        if (socket.readyState === socket.OPEN || socket.readyState === 1) {
          try {
            socket.send(message);
          } catch (err) {
            this.log.error({ err }, 'Falha ao enviar mensagem global via WebSocket');
          }
        }
      }
    }
  }

  clear() {
    for (const set of this.clientsByCompany.values()) {
      for (const entry of set) {
        try {
          entry.socket.close();
        } catch (err) {
          this.log.error({ err }, 'Erro ao fechar socket');
        }
      }
    }
    this.clientsByCompany.clear();
  }
}
