import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Login from './components/Login.jsx';
import Room from './components/Room.jsx';
import JoinBySlug from './components/JoinBySlug.jsx';
import './App.css';

const loadPersistedSession = () => {
  if (typeof localStorage === 'undefined') return null;
  const persisted = localStorage.getItem('vtrpg.session');
  if (!persisted) return null;
  try {
    const parsed = JSON.parse(persisted);
    if (parsed?.user?.name && parsed?.user?.role && parsed?.roomId) {
      return {
        roomId: parsed.roomId,
        roomSlug: parsed.roomSlug || parsed.roomId,
        user: parsed.user,
        playerId: parsed.playerId,
        playerToken: parsed.playerToken,
      };
    }
  } catch (err) {
    console.error('Failed to parse persisted session', err);
  }
  return null;
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

const RoomRoute = ({
  session,
  participants,
  images,
  onImagesUpdate,
  onDiceLogUpdate,
  onLogout,
  diceRoll,
  onSendDiceRoll,
  diceLog,
  onDiceResult,
}) => {
  const { roomIdentifier } = useParams();
  if (!session?.roomId || !session?.user) {
    return <Navigate to={`/room/${roomIdentifier}`} replace />;
  }

  const slugMatch = session.roomSlug && roomIdentifier === session.roomSlug;
  const idMatch = roomIdentifier === session.roomId;
  if (!slugMatch && !idMatch && session.roomSlug) {
    return <Navigate to={`/rooms/${session.roomSlug}`} replace />;
  }

  return (
    <Room
      roomId={session.roomId}
      roomSlug={session.roomSlug}
      user={session.user}
      images={images}
      participants={participants}
      onLogout={onLogout}
      onImagesUpdate={onImagesUpdate}
      onDiceLogUpdate={onDiceLogUpdate}
      diceRoll={diceRoll}
      onSendDiceRoll={onSendDiceRoll}
      diceLog={diceLog}
      onDiceResult={onDiceResult}
    />
  );
};

const initialSession = loadPersistedSession();

const App = () => {
  const [session, setSession] = useState(initialSession);
  const [roomSelection, setRoomSelection] = useState(() => initialSession?.roomSlug || initialSession?.roomId || 'alpha');
  const [sharedImages, setSharedImages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [connectionError, setConnectionError] = useState('');
  const [diceRoll, setDiceRoll] = useState(null);
  const [diceLog, setDiceLog] = useState([]);
  const diceChannelRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();

  const user = session?.user || null;
  const roomId = session?.roomId || '';
  const roomSlug = session?.roomSlug || '';

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (!user?.name || !user?.role || !roomId) {
      localStorage.removeItem('vtrpg.session');
      return;
    }
    const payload = {
      ...session,
      roomSlug: roomSlug || roomId,
    };
    localStorage.setItem('vtrpg.session', JSON.stringify(payload));
  }, [session, user?.name, user?.role, roomId, roomSlug]);

  useEffect(() => {
    if (session?.roomSlug || session?.roomId) {
      setRoomSelection(session.roomSlug || session.roomId);
    }
  }, [session?.roomSlug, session?.roomId]);

  useEffect(() => {
    if (session?.roomId && location.pathname === '/') {
      navigate(`/rooms/${roomSlug || roomId}`, { replace: true });
    }
  }, [session?.roomId, roomSlug, roomId, location.pathname, navigate]);

  useEffect(() => {
    setConnectionError('');
    setParticipants([]);
    setDiceLog([]);
  }, [roomId, user?.id, user?.role, user?.name]);

  const handleLogout = useCallback(() => {
    setSession(null);
    setSharedImages([]);
    setParticipants([]);
    setDiceLog([]);
    setConnectionError('');
    navigate('/');
  }, [navigate]);

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
    if (typeof BroadcastChannel === 'undefined' || !roomId) return undefined;

    const channelName = `vtrpg-dice-${roomId}`;
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

  const handleJoinSuccess = useCallback((payload, slug) => {
    if (!payload?.roomId || !payload?.player) return;
    const roomIdentifier = payload.roomSlug || slug || payload.roomId;
    const nextSession = {
      roomId: payload.roomId,
      roomSlug: roomIdentifier,
      user: {
        name: payload.player.name,
        role: payload.player.role || 'player',
        id: payload.player.id,
        token: payload.player.token,
      },
      playerId: payload.player.id,
      playerToken: payload.player.token,
    };
    setSession(nextSession);
    setRoomSelection(roomIdentifier);
    setSharedImages([]);
    setParticipants([]);
    setDiceLog([]);
    setConnectionError('');
  }, []);

  const handleLegacyLogin = useCallback((profile, room) => {
    const trimmedRoom = (room || roomSelection || 'alpha').trim() || 'alpha';
    setRoomSelection(trimmedRoom);
    const nextSession = {
      roomId: trimmedRoom,
      roomSlug: trimmedRoom,
      user: profile,
    };
    setSession(nextSession);
    setConnectionError('');
    setSharedImages([]);
    setParticipants([]);
    setDiceLog([]);
  }, [roomSelection]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h3>Virtual TTRPG Board</h3>
      </header>
      {connectionError && session?.user && <p className="error">{connectionError}</p>}
      <Routes>
        <Route
          path="/"
          element={
            session?.roomId ? (
              <Navigate to={`/rooms/${roomSlug || roomId}`} replace />
            ) : (
              <Login onLogin={handleLegacyLogin} defaultRoom={roomSelection} onRoomChange={setRoomSelection} />
            )
          }
        />
        <Route
          path="/room/:slug"
          element={<JoinBySlug onJoinSuccess={handleJoinSuccess} existingSession={session} />}
        />
        <Route
          path="/rooms/:roomIdentifier"
          element={(
            <RoomRoute
              session={session}
              participants={participants}
              images={sortedImages}
              onImagesUpdate={setSharedImages}
              onDiceLogUpdate={setDiceLog}
              onLogout={handleLogout}
              diceRoll={diceRoll}
              onSendDiceRoll={sendDiceRoll}
              diceLog={diceLog}
              onDiceResult={handleDiceResult}
            />
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
