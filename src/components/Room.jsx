import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Canvas from './Canvas.jsx';

const fetchImages = async (roomId) => {
  const response = await fetch(`/rooms/${roomId}/images`);
  if (!response.ok) throw new Error('Failed to load images');
  return response.json();
};

const Room = ({ roomId, user, images, participants, onImagesUpdate, onLogout }) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState([]);
  const [error, setError] = useState('');
  const isGM = user.role === 'gm';

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchImages(roomId)
      .then((data) => onImagesUpdate(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [roomId, onImagesUpdate]);

  const persistPosition = async (imageId, position) => {
    if (!position) return;
    try {
      const response = await fetch(`/rooms/${roomId}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(position),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Failed to move image');
      onImagesUpdate((prev) => prev.map((img) => (img.id === imageId ? payload : img)));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpload = async (files, position) => {
    if (!isGM) return;
    const validFiles = Array.from(files || []).filter((file) => file.size > 0);
    if (!validFiles.length) return;
    setError('');
    setUploading((prev) => [...prev, ...validFiles.map((file) => ({ name: file.name, status: 'pending' }))]);
    try {
      const formData = new FormData();
      validFiles.forEach((file) => formData.append('file', file));
      const response = await fetch(`/rooms/${roomId}/images`, { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Upload failed');
      const uploaded = Array.isArray(payload) ? payload : [payload];
      onImagesUpdate((prev) => [...prev, ...uploaded]);
      setUploading((prev) => prev.map((item) => ({ ...item, status: 'done' })));
      if (position) {
        uploaded.forEach((img) => {
          persistPosition(img.id, position);
        });
      }
    } catch (err) {
      setError(err.message);
      setUploading((prev) => prev.map((item) => ({ ...item, status: 'failed' })));
    } finally {
      setTimeout(() => setUploading([]), 1200);
    }
  };

  const handleShareUrl = async (url, position) => {
    if (!isGM) return;
    if (!/^https?:\/\//.test(url)) return;
    const confirmed = window.confirm(`Dela denna bild-URL?\n${url}`);
    if (!confirmed) return;
    try {
      setError('');
      const response = await fetch(`/rooms/${roomId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Share failed');
      onImagesUpdate((prev) => [...prev, payload]);
      if (position) {
        persistPosition(payload.id, position);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMoveImage = async (imageId, position) => {
    if (!isGM) return;
    onImagesUpdate((prev) => prev.map((img) => (img.id === imageId ? { ...img, ...position } : img)));
    await persistPosition(imageId, position);
  };

  const handleRemoveImage = async (imageId) => {
    if (!isGM) return;
    // Optimistically remove locally; rely on server DELETE success
    onImagesUpdate((prev) => prev.filter((img) => img.id !== imageId));
    try {
      const response = await fetch(`/rooms/${roomId}/images/${imageId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to remove image');
      // Do not refetch; keeps client state authoritative for tests and avoids duplication
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="room">
      <header className="room-header">
        <div>
          <h2>Room: {roomId}</h2>
          <p>
            Inloggad som {user.name} ({isGM ? 'Spelledare' : 'Spelare'})
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={onLogout}>
          Logga ut
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {loading && <p>Laddar bilder...</p>}

      {uploading.length > 0 && (
        <ul className="upload-list">
          {uploading.map((item) => (
            <li key={item.name} className={`upload upload--${item.status}`}>
              {item.name} - {item.status}
            </li>
          ))}
        </ul>
      )}

      <Canvas
        images={images}
        isGM={isGM}
        onUploadFiles={handleUpload}
        onShareUrl={handleShareUrl}
        onMoveImage={handleMoveImage}
        onRemoveImage={handleRemoveImage}
      />

      <footer className="participant-panel">
        <div className="participant-panel__header">
          <h3>Aktiva användare</h3>
          <span className="participant-count">{participants.length} online</span>
        </div>
        <ul className="participant-list">
          {participants.map((participant, index) => (
            <li
              key={`${participant.name}-${participant.role}-${index}`}
              className={`participant-chip participant-chip--${participant.role}`}
            >
              <span className="participant-name">{participant.name}</span>
              <span className="participant-role">{participant.role === 'gm' ? 'Spelledare' : 'Spelare'}</span>
            </li>
          ))}
          {participants.length === 0 && <li className="participant-chip">Inga aktiva användare</li>}
        </ul>
      </footer>
    </section>
  );
};

Room.propTypes = {
  roomId: PropTypes.string.isRequired,
  user: PropTypes.shape({
    name: PropTypes.string.isRequired,
    role: PropTypes.string.isRequired,
  }).isRequired,
  participants: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string,
      role: PropTypes.string,
    })
  ).isRequired,
  images: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    url: PropTypes.string,
    status: PropTypes.string,
    x: PropTypes.number,
    y: PropTypes.number,
  })).isRequired,
  onImagesUpdate: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
};

export default Room;
