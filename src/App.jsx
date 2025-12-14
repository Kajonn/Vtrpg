import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Login from './components/Login.jsx';
import Room from './components/Room.jsx';
import './App.css';

const useWebSocket = (roomId, user, onMessage, onError) => {
  const [socket, setSocket] = useState(null);
  
  useEffect(() => {
    if (!roomId || !user?.role || !user?.name) {
      setSocket(null);
      return undefined;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams();
    params.set('role', user.role);
    params.set('name', user.name);
    const query = params.toString();
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/rooms/${roomId}?${query}`);
    ws.addEventListener('open', () => {
      setSocket(ws);
    });
    ws.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage(parsed);
      } catch (error) {
        console.error('Failed to parse message', error);
      }
    });
    ws.addEventListener('error', () => {
      onError?.('Kunde inte ansluta till liveuppdateringar.');
    });
    ws.addEventListener('close', (event) => {
      setSocket(null);
      if (event.code === 1006 || event.code === 1008) {
        onError?.('Anslutningen till rummet stängdes.');
      }
    });
    return () => {
      ws.close();
      setSocket(null);
    };
  }, [roomId, user?.role, user?.name, onMessage, onError]);
  
  return socket;
};

const App = () => {
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState('alpha');
  const [sharedImages, setSharedImages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [connectionError, setConnectionError] = useState('');
  const [diceRoll, setDiceRoll] = useState(null);
  const [diceLog, setDiceLog] = useState([]);
  const diceChannelRef = useRef(null);

  const handleLogout = useCallback(() => {
    setUser(null);
    setSharedImages([]);
    setParticipants([]);
    setConnectionError('');
    localStorage.removeItem('vtrpg.session');
  }, []);

  useEffect(() => {
    const persisted = localStorage.getItem('vtrpg.session');
    if (!persisted) return;
    try {
      const parsed = JSON.parse(persisted);
      if (parsed?.user?.name && parsed?.user?.role && parsed?.roomId) {
        setUser(parsed.user);
        setRoomId(parsed.roomId);
      }
    } catch (err) {
      console.error('Failed to parse persisted session', err);
    }
  }, []);

  const handleMessage = useCallback((message) => {
    if (message?.type === 'SharedImage') {
      setSharedImages((prev) => {
        const existing = prev.find((img) => img.id === message.payload.id);
        if (existing) {
          return prev.map((img) => (img.id === message.payload.id ? message.payload : img));
        }
        return [...prev, message.payload];
      });
    } else if (message?.type === 'SharedImageDeleted') {
      const id = message.payload?.id;
      if (!id) return;
      setSharedImages((prev) => prev.filter((img) => img.id !== id));
    } else if (message?.type === 'RosterUpdate') {
      const users = Array.isArray(message.payload?.users) ? message.payload.users : [];
      const sorted = [...users].sort((a, b) => {
        if (a.role === b.role) return (a.name || '').localeCompare(b.name || '');
        if (a.role === 'gm') return -1;
        if (b.role === 'gm') return 1;
        return 0;
      });
      setParticipants(sorted);
    } else if (message?.type === 'DiceRoll') {
      setDiceRoll(message.payload);
      diceChannelRef.current?.postMessage({ type: 'DiceRoll', payload: message.payload });
    }
  }, []);

  const socket = useWebSocket(roomId, user, handleMessage, setConnectionError);

  const sendDiceRoll = useCallback((seed, count) => {
    const payload = { seed, count };
    diceChannelRef.current?.postMessage({ type: 'DiceRoll', payload });
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify({ type: 'DiceRoll', payload });
    socket.send(message);
  }, [socket]);

  const handleDiceResult = useCallback(({ seed, count, results }) => {
    const timestamp = new Date().toISOString();
    setDiceLog((prev) => [
      { id: `${seed}-${timestamp}`, seed, count, results, timestamp },
      ...prev,
    ].slice(0, 20));
  }, []);

  const sortedImages = useMemo(
    () => [...sharedImages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)),
    [sharedImages]
  );

  useEffect(() => {
    setConnectionError('');
    setParticipants([]);
  }, [roomId, user]);

  useEffect(() => {
    if (user?.name && user?.role) {
      localStorage.setItem('vtrpg.session', JSON.stringify({ user, roomId }));
    } else {
      localStorage.removeItem('vtrpg.session');
    }
  }, [user, roomId]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;

    const channelName = `vtrpg-dice-${roomId || 'default'}`;
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (event) => {
      if (event.data?.type === 'DiceRoll' && event.data?.payload) {
        setDiceRoll(event.data.payload);
      }
    };
    diceChannelRef.current = channel;

    return () => {
      channel.close();
      diceChannelRef.current = null;
    };
  }, [roomId]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Virtual TTRPG Board</h1>
      </header>
      {connectionError && <p className="error">{connectionError}</p>}
      {!user ? (
        <Login onLogin={(profile) => setUser(profile)} defaultRoom={roomId} onRoomChange={setRoomId} />
      ) : (
        <Room
          roomId={roomId}
          user={user}
          images={sortedImages}
          participants={participants}
          onLogout={handleLogout}
          onImagesUpdate={setSharedImages}
          diceRoll={diceRoll}
          onSendDiceRoll={sendDiceRoll}
          diceLog={diceLog}
          onDiceResult={handleDiceResult}
        />
      )}
    </div>
  );
};

export default App;
