import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Canvas from './Canvas.jsx';

const fetchImages = async (roomId) => {
  const response = await fetch(`/rooms/${roomId}/images`);
  if (!response.ok) throw new Error('Failed to load images');
  return response.json();
};

const Room = ({
  roomId,
  user,
  images,
  participants,
  onImagesUpdate,
  onDiceLogUpdate,
  onLogout,
  diceRoll,
  onSendDiceRoll,
  diceLog,
  onDiceResult,
  inviteUrl,
}) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState([]);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const isGM = user.role === 'gm';

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchImages(roomId)
      .then((data) => onImagesUpdate(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    if (onDiceLogUpdate) {
      fetch(`/rooms/${roomId}/dice`)
        .then((response) => {
          if (!response.ok) throw new Error('Failed to load dice log');
          return response.json();
        })
        .then((log) => onDiceLogUpdate(Array.isArray(log) ? log : []))
        .catch((err) => setError((prev) => prev || err.message));
    }
  }, [roomId, onImagesUpdate, onDiceLogUpdate]);

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

  const handleCopyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('Kopierad!');
      setTimeout(() => setCopyStatus(''), 1500);
    } catch (err) {
      console.warn('Failed to copy invite link', err);
      setCopyStatus('Kunde inte kopiera');
      setTimeout(() => setCopyStatus(''), 2000);
    }
  };

  return (
    <section className="room">
      {uploading.length > 0 && (
        <ul className="upload-list">
          {uploading.map((item) => (
            <li key={item.name} className={`upload upload--${item.status}`}>
              {item.name} - {item.status}
            </li>
          ))}
        </ul>
      )}

      <div className="room-main">
        <Canvas
          images={images}
          isGM={isGM}
          roomId={roomId}
          onUploadFiles={handleUpload}
          onShareUrl={handleShareUrl}
          onMoveImage={handleMoveImage}
          onRemoveImage={handleRemoveImage}
          diceRoll={diceRoll}
          onSendDiceRoll={onSendDiceRoll}
          onDiceResult={onDiceResult}
          userName={user.name}
        />

        <section className="log-window" aria-label="dice-log">
        <div className="log-window__header">
          <h3>Tärningslogg</h3>
          <span className="log-window__hint">Senaste slaget visas först</span>
        </div>
                {diceLog?.length ? (
          <ol className="log-window__list">
            {diceLog.map((entry, index) => (
              <li key={entry.id || `${entry.seed}-${index}`} className="log-window__item">
                <div className="log-window__meta">
                  <span>Slag av {entry.triggeredBy || 'Okänd'}</span>
                  <span className="log-window__seed">Seed: {entry.seed}</span>
                </div>
                <div className="log-window__dice">
                  {entry.results.map((result, dieIndex) => (
                    <span key={`${entry.id}-${dieIndex}`} className="log-window__die">
                      Tärning {dieIndex + 1}: {result}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="log-window__empty">Inga tärningsresultat ännu.</p>
        )}
      </section>
    </div>

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

      <div className="room-footer">
        <div className="room-footer__meta">
          <div>
            <strong>Room: {roomId}</strong> | Inloggad som {user.name} ({isGM ? 'Spelledare' : 'Spelare'})
          </div>
          {inviteUrl && (
            <div className="invite-row">
              <span className="invite-row__label">Bjud in:</span>
              <input value={inviteUrl} readOnly className="invite-row__input" aria-label="invite-link" />
              <button type="button" className="ghost-button" onClick={handleCopyInvite}>
                {copyStatus || 'Kopiera länk'}
              </button>
            </div>
          )}
        </div>
        <button type="button" className="ghost-button" onClick={onLogout}>
          Logga ut
        </button>
        {error && <p className="error" style={{ margin: '0.5rem 0 0' }}>{error}</p>}
        {loading && <p style={{ margin: '0.5rem 0 0' }}>Laddar bilder...</p>}
      </div>
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
  onDiceLogUpdate: PropTypes.func,
  onLogout: PropTypes.func.isRequired,
  diceRoll: PropTypes.shape({
    seed: PropTypes.number,
    count: PropTypes.number,
    sides: PropTypes.number,
  }),
  onSendDiceRoll: PropTypes.func,
  diceLog: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      seed: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      count: PropTypes.number,
      results: PropTypes.arrayOf(PropTypes.number),
      triggeredBy: PropTypes.string,
      timestamp: PropTypes.string,
    })
  ),
  onDiceResult: PropTypes.func,
  inviteUrl: PropTypes.string,
};

export default Room;
