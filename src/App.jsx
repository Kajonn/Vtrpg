import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Login from './components/Login.jsx';
import Room from './components/Room.jsx';
import './App.css';

const getRoomFromURL = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    return room ? room.trim() : '';
  } catch (err) {
    console.warn('Failed to read room from URL', err);
    return '';
  }
};

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
  const initialRoomFromUrl = useRef(getRoomFromURL());
  const [roomId, setRoomId] = useState(() => initialRoomFromUrl.current || 'alpha');
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
    setDiceLog([]);
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
        setRoomId(initialRoomFromUrl.current || parsed.roomId);
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
      const payload = {
        ...message.payload,
        triggeredBy: message.payload?.triggeredBy || 'Okänd',
      };
      setDiceRoll(payload);
      diceChannelRef.current?.postMessage({ type: 'DiceRoll', payload });
    } else if (message?.type === 'DiceLogEntry' && message.payload) {
      setDiceLog((prev) => [message.payload, ...prev.filter((entry) => entry.id !== message.payload.id)].slice(0, 50));
    }
  }, []);

  const socket = useWebSocket(roomId, user, handleMessage, setConnectionError);

  const sendDiceRoll = useCallback((seed, count, sides, triggeredBy) => {
    const roller = triggeredBy || user?.name || 'Okänd';
    const payload = { seed, count, sides, triggeredBy: roller };
    diceChannelRef.current?.postMessage({ type: 'DiceRoll', payload });
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify({ type: 'DiceRoll', payload });
    socket.send(message);
  }, [socket, user?.name]);

  const handleDiceResult = useCallback((results) => {
    if (!diceRoll) return;

    const { seed, count, triggeredBy } = diceRoll;
    const timestamp = new Date().toISOString();
    const roller = triggeredBy || user?.name || 'Okänd';
    const entry = { id: `${seed}-${timestamp}`, seed, count, results, timestamp, triggeredBy: roller };
    setDiceLog((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, 50));

    if (roller === user?.name) {
      fetch(`/rooms/${roomId}/dice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, count, results, triggeredBy: roller, timestamp }),
      })
        .then((response) => response.json())
        .then((saved) => {
          setDiceLog((prev) => [saved, ...prev.filter((item) => item.id !== saved.id && item.seed !== saved.seed)].slice(0, 50));
        })
        .catch(() => {});
    }
  }, [diceRoll, roomId, user?.name]);

  const sortedImages = useMemo(
    () => [...sharedImages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)),
    [sharedImages]
  );

  useEffect(() => {
    setConnectionError('');
    setParticipants([]);
    setDiceLog([]);
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
        const payload = {
          ...event.data.payload,
          triggeredBy: event.data.payload?.triggeredBy || 'Okänd',
        };
        setDiceRoll(payload);
      }
    };
    diceChannelRef.current = channel;

    return () => {
      channel.close();
      diceChannelRef.current = null;
    };
  }, [roomId]);

  const buildInviteUrl = useCallback((value) => {
    if (!value) return '';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', value);
    return url.toString();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h3>Virtual TTRPG Board</h3>
      </header>
      {connectionError && <p className="error">{connectionError}</p>}
      {!user ? (
        <Login
          onLogin={(profile) => setUser(profile)}
          defaultRoom={roomId}
          onRoomChange={setRoomId}
          buildInviteUrl={buildInviteUrl}
        />
      ) : (
        <Room
          roomId={roomId}
          user={user}
          images={sortedImages}
          participants={participants}
          onLogout={handleLogout}
          onImagesUpdate={setSharedImages}
          onDiceLogUpdate={setDiceLog}
          diceRoll={diceRoll}
          onSendDiceRoll={sendDiceRoll}
          diceLog={diceLog}
          onDiceResult={handleDiceResult}
          inviteUrl={buildInviteUrl(roomId)}
        />
      )}
    </div>
  );
};

export default App;
