import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { WebSocketServer } from 'ws';

const diceSocketPlugin = () => ({
  name: 'vtrpg-dice-socket-fallback',
  configureServer(server) {
    const rooms = new Map();
    const wss = new WebSocketServer({ noServer: true });

    const broadcast = (room, message) => {
      const peers = rooms.get(room) || new Set();
      peers.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.send(message);
        }
      });
    };

    const attachClient = (ws, room) => {
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(ws);

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed?.type === 'DiceRoll') {
            broadcast(
              room,
              JSON.stringify({
                type: 'DiceRoll',
                payload: parsed.payload,
              })
            );
          }
        } catch (error) {
          console.warn('dice socket parse error', error);
        }
      });

      ws.on('close', () => {
        const peers = rooms.get(room);
        if (!peers) return;
        peers.delete(ws);
        if (peers.size === 0) rooms.delete(room);
      });
    };

    server.httpServer?.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/ws/rooms/')) return;
      const room = url.pathname.split('/').pop();
      wss.handleUpgrade(request, socket, head, (ws) => attachClient(ws, room));
    });
  },
});

export default defineConfig({
  plugins: [react(), diceSocketPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
