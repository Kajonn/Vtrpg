import { useState, useEffect, useMemo, useCallback } from 'react';
import Login from './components/Login.jsx';
import Room from './components/Room.jsx';
import './App.css';

const useWebSocket = (roomId, onMessage) => {
  useEffect(() => {
    if (!roomId) return undefined;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/rooms/${roomId}`);
    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage(parsed);
      } catch (error) {
        console.error('Failed to parse message', error);
      }
    });
    return () => socket.close();
  }, [roomId, onMessage]);
};

const App = () => {
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState('alpha');
  const [sharedImages, setSharedImages] = useState([]);

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
    }
  }, []);

  useWebSocket(roomId, handleMessage);

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
        <Room roomId={roomId} user={user} images={sortedImages} onImagesUpdate={setSharedImages} />
      )}
    </div>
  );
};

export default App;
