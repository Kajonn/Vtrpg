import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Canvas from './Canvas.jsx';

const fetchImages = async (roomId) => {
  const response = await fetch(`/rooms/${roomId}/images`);
  if (!response.ok) throw new Error('Failed to load images');
  return response.json();
};

const Room = ({ roomId, user, images, onImagesUpdate }) => {
  const dropRef = useRef(null);
  const urlInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchImages(roomId)
      .then((data) => onImagesUpdate(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [roomId, onImagesUpdate]);

  const handleDrop = async (event) => {
    event.preventDefault();
    if (user.role !== 'gm') return;
    const urlFromDrop = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text');
    if (urlFromDrop) {
      await submitUrl(urlFromDrop);
      return;
    }

    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.size > 0);
    if (!files.length) return;
    setError('');
    setUploading((prev) => [...prev, ...files.map((file) => ({ name: file.name, status: 'pending' }))]);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('file', file));
      const response = await fetch(`/rooms/${roomId}/images`, { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Upload failed');
      onImagesUpdate((prev) => [...prev, ...(Array.isArray(payload) ? payload : [payload])]);
      setUploading((prev) => prev.map((item) => ({ ...item, status: 'done' })));
    } catch (err) {
      setError(err.message);
      setUploading((prev) => prev.map((item) => ({ ...item, status: 'failed' })));
    } finally {
      setTimeout(() => setUploading([]), 1200);
    }
  };

  const handlePaste = async (event) => {
    if (user.role !== 'gm') return;
    const url = event.clipboardData?.getData('text');
    if (!url) return;
    await submitUrl(url);
  };

  const submitUrl = async (url) => {
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
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleUrlSubmit = async (event) => {
    event.preventDefault();
    const url = urlInputRef.current.value;
    urlInputRef.current.value = '';
    await submitUrl(url);
  };

  return (
    <section className="room">
      <header className="room-header">
        <div>
          <h2>Room: {roomId}</h2>
          <p>
            Inloggad som {user.name} ({user.role === 'gm' ? 'Spelledare' : 'Spelare'})
          </p>
        </div>
        {user.role === 'gm' && (
          <form className="inline-form" onSubmit={handleUrlSubmit}>
            <input ref={urlInputRef} placeholder="Klistra in bild-URL" />
            <button type="submit">Dela URL</button>
          </form>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {loading && <p>Laddar bilder...</p>}

      <div
        ref={dropRef}
        className={`dropzone ${user.role !== 'gm' ? 'dropzone--disabled' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onPaste={handlePaste}
      >
        {user.role === 'gm' ? 'Släpp filer eller klistra in URL/bild' : 'Endast visning - väntar på spelledaren'}
      </div>

      {uploading.length > 0 && (
        <ul className="upload-list">
          {uploading.map((item) => (
            <li key={item.name} className={`upload upload--${item.status}`}>
              {item.name} - {item.status}
            </li>
          ))}
        </ul>
      )}

      <Canvas images={images} />
    </section>
  );
};

Room.propTypes = {
  roomId: PropTypes.string.isRequired,
  user: PropTypes.shape({
    name: PropTypes.string.isRequired,
    role: PropTypes.string.isRequired,
  }).isRequired,
  images: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    url: PropTypes.string,
    status: PropTypes.string,
  })).isRequired,
  onImagesUpdate: PropTypes.func.isRequired,
};

export default Room;
