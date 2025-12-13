import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Login from './components/Login.jsx';
import Room from './components/Room.jsx';
import './App.css';

const useWebSocket = (roomId, onMessage) => {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!roomId) return undefined;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socketFactory = window.__mockWebSocket;
    const socket = socketFactory
      ? socketFactory(roomId, onMessage)
      : new WebSocket(`${protocol}://${window.location.host}/ws/rooms/${roomId}`);
    socketRef.current = socket;
    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage(parsed);
      } catch (error) {
        console.error('Failed to parse message', error);
      }
    });
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [roomId, onMessage]);

  const send = useCallback((payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  return send;
};

const App = () => {
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState('alpha');
  const [sharedImages, setSharedImages] = useState([]);
  const [diceCount, setDiceCount] = useState(4);
  const [diceSeed, setDiceSeed] = useState(0);
  const [diceRollId, setDiceRollId] = useState(0);

  const clampDiceCount = useCallback((value) => Math.max(1, Math.min(12, value)), []);

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
    } else if (message?.type === 'DiceRoll') {
      const { count, seed } = message.payload || {};
      if (typeof count === 'number' && typeof seed === 'number') {
        setDiceCount(clampDiceCount(count));
        setDiceSeed(seed >>> 0);
        setDiceRollId((prev) => prev + 1);
      }
    }
  }, [clampDiceCount]);

  const sendMessage = useWebSocket(roomId, handleMessage);

  const requestDiceRoll = useCallback(() => {
    const success = sendMessage({ type: 'DiceRollRequest', payload: { count: diceCount } });
    if (!success) {
      const fallbackSeed = Math.floor(Math.random() * 4294967295);
      setDiceSeed(fallbackSeed >>> 0);
      setDiceRollId((prev) => prev + 1);
    }
  }, [sendMessage, diceCount]);

  const sortedImages = useMemo(
    () => [...sharedImages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)),
    [sharedImages]
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Virtual TTRPG Board</h1>
      </header>
      {!user ? (
        <Login onLogin={(profile) => setUser(profile)} defaultRoom={roomId} onRoomChange={setRoomId} />
      ) : (
        <Room
          roomId={roomId}
          user={user}
          images={sortedImages}
          onImagesUpdate={setSharedImages}
          diceCount={diceCount}
          diceSeed={diceSeed}
          diceRollId={diceRollId}
          onDiceCountChange={(value) => setDiceCount(clampDiceCount(value))}
          onDiceRoll={requestDiceRoll}
        />
      )}
    </div>
  );
};

export default App;
