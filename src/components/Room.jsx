import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import Canvas from './Canvas.jsx';

// Theme definitions with preview colors
const THEMES = [
  { id: 'default', name: 'Default', colors: ['#0f172a', '#22d3ee', '#0ea5e9'] },
  { id: 'dracula', name: 'Dracula', colors: ['#282a36', '#bd93f9', '#ff79c6'] },
  { id: 'nord', name: 'Nord', colors: ['#2e3440', '#88c0d0', '#81a1c1'] },
  { id: 'gruvbox', name: 'Gruvbox', colors: ['#282828', '#fe8019', '#fabd2f'] },
  { id: 'solarized', name: 'Solarized', colors: ['#002b36', '#2aa198', '#268bd2'] },
  { id: 'monokai', name: 'Monokai', colors: ['#272822', '#a6e22e', '#66d9ef'] },
  { id: 'forest', name: 'Forest', colors: ['#1a2f1a', '#4ade80', '#22c55e'] },
  { id: 'sunset', name: 'Sunset', colors: ['#1f1315', '#f97316', '#ef4444'] },
  { id: 'ocean', name: 'Ocean', colors: ['#0a1628', '#0077b6', '#00b4d8'] },
  { id: 'cyberpunk', name: 'Cyberpunk', colors: ['#0d0221', '#ff00ff', '#00ffff'] },
  { id: 'vampire', name: 'Vampire', colors: ['#1a0a0a', '#8b0000', '#dc143c'] },
  { id: 'midnight', name: 'Midnight', colors: ['#0f0f23', '#4c1d95', '#7c3aed'] },
  { id: 'aurora', name: 'Aurora', colors: ['#0f172a', '#22c55e', '#a855f7'] },
  { id: 'desert', name: 'Desert', colors: ['#1c1510', '#d97706', '#fbbf24'] },
  { id: 'arctic', name: 'Arctic', colors: ['#1e293b', '#7dd3fc', '#e0f2fe'] },
  { id: 'lavender', name: 'Lavender', colors: ['#1e1b2e', '#a78bfa', '#c4b5fd'] },
  { id: 'rose', name: 'Rose', colors: ['#1f1218', '#f472b6', '#fda4af'] },
  { id: 'emerald', name: 'Emerald', colors: ['#0a1f0a', '#10b981', '#fbbf24'] },
  { id: 'slate', name: 'Slate', colors: ['#1e293b', '#64748b', '#94a3b8'] },
  { id: 'coffee', name: 'Coffee', colors: ['#1a1410', '#92400e', '#d4a574'] },
  { id: 'neon', name: 'Neon', colors: ['#0a0a0a', '#39ff14', '#00ff00'] },
  { id: 'plum', name: 'Plum', colors: ['#1a0f1f', '#9333ea', '#e879f9'] },
  { id: 'storm', name: 'Storm', colors: ['#1a1c2e', '#6366f1', '#a5b4fc'] },
  { id: 'cherry', name: 'Cherry', colors: ['#1f0a14', '#ff6b9d', '#ffc0cb'] },
  { id: 'galaxy', name: 'Galaxy', colors: ['#0a0015', '#8b5cf6', '#c084fc'] },
  { id: 'mint', name: 'Mint', colors: ['#0a1f1a', '#34d399', '#6ee7b7'] },
  { id: 'rust', name: 'Rust', colors: ['#1a0f08', '#ea580c', '#fb923c'] },
  { id: 'sapphire', name: 'Sapphire', colors: ['#0a1428', '#2563eb', '#60a5fa'] },
  { id: 'coral', name: 'Coral', colors: ['#1f1410', '#f97316', '#fb7185'] },
  { id: 'onyx', name: 'Onyx', colors: ['#0a0a0a', '#525252', '#a3a3a3'] },
  { id: 'amber', name: 'Amber', colors: ['#1a1408', '#f59e0b', '#fbbf24'] },
  { id: 'twilight', name: 'Twilight', colors: ['#1a0f20', '#8b5cf6', '#f97316'] },
  { id: 'pine', name: 'Pine', colors: ['#0a1a12', '#166534', '#22c55e'] },
  { id: 'maroon', name: 'Maroon', colors: ['#1a0808', '#881337', '#be123c'] },
];

const fetchImages = async (roomId) => {
  const response = await fetch(`/rooms/${roomId}/images`, {
    headers: {
      'Accept': 'application/json',
    },
  });
  if (!response.ok) throw new Error('Failed to load images');
  return response.json();
};

const Room = ({
  roomId,
  user,
  roomSlug,
  images,
  participants,
  onImagesUpdate,
  onDiceLogUpdate,
  onLogout,
  diceRoll,
  onSendDiceRoll,
  diceLog,
  onDiceResult,
  theme,
  onThemeChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState([]);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const isGM = user.role === 'gm';

  const shareUrl = useMemo(() => {
    const identifier = roomSlug || roomId;
    return `${window.location.origin}/room/${identifier}`;
  }, [roomId, roomSlug]);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchImages(roomId)
      .then((data) => {
        if (!Array.isArray(data)) {
          console.error('fetchImages returned non-array:', data);
          throw new Error('Invalid response format');
        }
        onImagesUpdate(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    if (onDiceLogUpdate) {
      fetch(`/rooms/${roomId}/dice`, {
        headers: {
          'Accept': 'application/json',
        },
      })
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
    const confirmed = window.confirm(`Share this image URL?\n${url}`);
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

  const handleResizeImage = async (imageId, size) => {
    if (!isGM) return;
    onImagesUpdate((prev) => prev.map((img) => (img.id === imageId ? { ...img, ...size } : img)));
    try {
      const response = await fetch(`/rooms/${roomId}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(size),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Failed to resize image');
      onImagesUpdate((prev) => prev.map((img) => (img.id === imageId ? payload : img)));
    } catch (err) {
      setError(err.message);
    }
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

  const handleToggleHidden = async (imageId, hidden) => {
    if (!isGM) return;
    // Optimistically update locally
    onImagesUpdate((prev) => prev.map((img) => (img.id === imageId ? { ...img, hidden } : img)));
    try {
      const response = await fetch(`/rooms/${roomId}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Failed to toggle image visibility');
      onImagesUpdate((prev) => prev.map((img) => (img.id === imageId ? payload : img)));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopyInvite = async () => {
    setCopyStatus('');
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyStatus('Link copied.');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch (err) {
      setCopyStatus('Could not copy link.');
    }
  };

  const [showDiceLog, setShowDiceLog] = useState(false);
  const [showGMTools, setShowGMTools] = useState(false);
  const [diceSettings, setDiceSettings] = useState({
    clearTimeout: 5000,
    velocityMultiplier: { x: 1, y: 1, z: 1 },
  });

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

      {/* Error and loading notifications - visible to all users */}
      {error && (
        <div className="notification notification--error">
          {error}
        </div>
      )}
      {loading && (
        <div className="notification notification--loading">
          Loading images...
        </div>
      )}

      <div className="room-main">
        <Canvas
          images={images}
          isGM={isGM}
          roomId={roomId}
          onUploadFiles={handleUpload}
          onShareUrl={handleShareUrl}
          onMoveImage={handleMoveImage}
          onResizeImage={handleResizeImage}
          onRemoveImage={handleRemoveImage}
          onToggleHidden={handleToggleHidden}
          diceRoll={diceRoll}
          onSendDiceRoll={onSendDiceRoll}
          onDiceResult={onDiceResult}
          userName={user.name}
          diceSettings={diceSettings}
        />

        {/* Dice Log Toggle Button */}
        <button
          type="button"
          className="overlay-toggle dice-log-toggle"
          onClick={() => setShowDiceLog(!showDiceLog)}
          title="Toggle Dice Log"
        >
          🎲 Dice Log
        </button>

        {/* GM Tools Toggle Button (GM only) */}
        {isGM && (
          <button
            type="button"
            className="overlay-toggle gm-tools-toggle"
            onClick={() => setShowGMTools(!showGMTools)}
            title="Toggle GM Tools"
          >
            ⚙️ GM Tools
          </button>
        )}

        {/* Dice Log Overlay */}
        {showDiceLog && (
          <div className="overlay-backdrop" onClick={() => setShowDiceLog(false)}>
            <section className="log-window overlay-window" aria-label="dice-log" onClick={(e) => e.stopPropagation()}>
              <div className="log-window__header">
                <h3>Dice Log</h3>
                <button
                  type="button"
                  className="overlay-close"
                  onClick={() => setShowDiceLog(false)}
                  title="Close"
                >
                  ✕
                </button>
              </div>
              <span className="log-window__hint">Most recent roll shown first</span>
              {diceLog?.length ? (
                <ol className="log-window__list">
                  {diceLog.map((entry, index) => (
                    <li key={entry.id || `${entry.seed}-${index}`} className="log-window__item">
                      <div className="log-window__meta">
                        <span>Roll by {entry.triggeredBy || 'Unknown'}</span>
                        <span className="log-window__seed">Seed: {entry.seed}</span>
                      </div>
                      <div className="log-window__dice">
                        {entry.results.map((result, dieIndex) => (
                          <span key={`${entry.id}-${dieIndex}`} className="log-window__die">
                            Die {dieIndex + 1}: {result}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="log-window__empty">No dice results yet.</p>
              )}
            </section>
          </div>
        )}

        {/* GM Tools Overlay */}
        {isGM && showGMTools && (
          <div className="overlay-backdrop" onClick={() => setShowGMTools(false)}>
            <section className="gm-tools-window overlay-window" onClick={(e) => e.stopPropagation()}>
              <div className="gm-tools__header">
                <h3>GM Tools</h3>
                <button
                  type="button"
                  className="overlay-close"
                  onClick={() => setShowGMTools(false)}
                  title="Close"
                >
                  ✕
                </button>
              </div>
              <div className="gm-tools__content">
                <div className="invite-link">
                  <label>Shareable Room Link:</label>
                  <code>{shareUrl}</code>
                  <button type="button" className="ghost-button" onClick={handleCopyInvite}>
                    Copy link
                  </button>
                  {copyStatus && <p className="muted">{copyStatus}</p>}
                </div>
                
                <div className="gm-tools__section">
                  <h4>Dice Settings</h4>
                  <div className="gm-tools__row">
                    <label htmlFor="gm-clear-timeout">Clear timeout (ms)</label>
                    <input
                      id="gm-clear-timeout"
                      type="number"
                      min="1000"
                      max="30000"
                      step="500"
                      value={diceSettings.clearTimeout}
                      onChange={(e) => setDiceSettings(prev => ({
                        ...prev,
                        clearTimeout: Math.max(1000, Math.min(30000, parseInt(e.target.value, 10) || 5000)),
                      }))}
                    />
                  </div>
                  <div className="gm-tools__subsection">
                    <span className="gm-tools__subsection-label">Velocity Multipliers</span>
                    <div className="gm-tools__row">
                      <label htmlFor="gm-vel-x">X</label>
                      <input
                        id="gm-vel-x"
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={diceSettings.velocityMultiplier.x}
                        onChange={(e) => setDiceSettings(prev => ({
                          ...prev,
                          velocityMultiplier: {
                            ...prev.velocityMultiplier,
                            x: Math.max(0, Math.min(5, parseFloat(e.target.value) || 1)),
                          },
                        }))}
                      />
                    </div>
                    <div className="gm-tools__row">
                      <label htmlFor="gm-vel-y">Y</label>
                      <input
                        id="gm-vel-y"
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={diceSettings.velocityMultiplier.y}
                        onChange={(e) => setDiceSettings(prev => ({
                          ...prev,
                          velocityMultiplier: {
                            ...prev.velocityMultiplier,
                            y: Math.max(0, Math.min(5, parseFloat(e.target.value) || 1)),
                          },
                        }))}
                      />
                    </div>
                    <div className="gm-tools__row">
                      <label htmlFor="gm-vel-z">Z</label>
                      <input
                        id="gm-vel-z"
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={diceSettings.velocityMultiplier.z}
                        onChange={(e) => setDiceSettings(prev => ({
                          ...prev,
                          velocityMultiplier: {
                            ...prev.velocityMultiplier,
                            z: Math.max(0, Math.min(5, parseFloat(e.target.value) || 1)),
                          },
                        }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="gm-tools__section">
                  <h4>Room Theme</h4>
                  <div className="theme-selector">
                    <div className="theme-selector__dropdown">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`theme-selector__item ${theme === t.id ? 'theme-selector__item--active' : ''}`}
                          onClick={() => onThemeChange?.(t.id)}
                        >
                          <div className="theme-selector__preview">
                            {t.colors.map((color, i) => (
                              <div
                                key={i}
                                className="theme-selector__preview-swatch"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                          <span className="theme-selector__name">{t.name}</span>
                          {theme === t.id && <span className="theme-selector__check">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                
                <button type="button" className="ghost-button" onClick={onLogout}>
                  Logga ut
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      <footer className="room-footer">
        <h3 className="room-footer__title">Virtual TTRPG Board</h3>
        <div className="participant-panel">
          <span className="participant-count">{participants.length} online</span>
          <ul className="participant-list">
            {participants.map((participant, index) => (
              <li
                key={`${participant.name}-${participant.role}-${index}`}
                className={`participant-chip participant-chip--${participant.role}`}
              >
                <span className="participant-name">{participant.name}</span>
              </li>
            ))}
            {participants.length === 0 && <li className="participant-chip">No active users</li>}
          </ul>
        </div>
        <div className="room-footer__actions">
          <Link to="/admin" className="ghost-button">
            Admin
          </Link>
          {!isGM && (
            <button type="button" className="ghost-button logout-button" onClick={onLogout}>
              Log out
            </button>
          )}
        </div>
      </footer>
    </section>
  );
};

Room.propTypes = {
  roomId: PropTypes.string.isRequired,
  user: PropTypes.shape({
    name: PropTypes.string.isRequired,
    role: PropTypes.string.isRequired,
    id: PropTypes.string,
    token: PropTypes.string,
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
    hidden: PropTypes.bool,
  })).isRequired,
  roomSlug: PropTypes.string,
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
  theme: PropTypes.string,
  onThemeChange: PropTypes.func,
};

export default Room;
