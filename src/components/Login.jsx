import { useState } from 'react';
import PropTypes from 'prop-types';

const Login = ({ onLogin, defaultRoom, onRoomChange, buildInviteUrl }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('gm');
  const [room, setRoom] = useState(defaultRoom || 'alpha');
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!room || !name) return;

    let gmCheckPassed = true;
    if (role === 'gm') {
      try {
        setSubmitting(true);
        const response = await fetch(`/rooms/${room}/gm`);
        if (response.ok) {
          const payload = await response.json();
          if (payload.active) {
            setError('Det finns redan en spelledare i detta rum.');
            gmCheckPassed = false;
          }
        } else {
          // If the GM check endpoint is unavailable, continue with a warning to avoid blocking offline play.
          console.warn('GM availability check failed', response.status);
        }
      } catch (err) {
        console.warn('GM availability check error', err);
      } finally {
        setSubmitting(false);
      }
    }

    if (!gmCheckPassed) return;

    onLogin({ name, role });
    onRoomChange(room);
  };

  const handleCreateRoom = async () => {
    setCreateError('');
    setError('');
    setInviteLink('');
    try {
      setCreatingRoom(true);
      const response = await fetch('/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roomName || room || 'Nytt rum',
          createdBy: name || 'anonymous',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Kunde inte skapa rummet.');
      }
      const slug = payload?.slug || payload?.id;
      if (!slug) {
        throw new Error('Kunde inte hämta rums-ID.');
      }
      setRoom(slug);
      onRoomChange(slug);
      if (buildInviteUrl) {
        setInviteLink(buildInviteUrl(slug));
      }
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyStatus('Kopierad!');
      setTimeout(() => setCopyStatus(''), 1500);
    } catch (err) {
      console.warn('Failed to copy invite link', err);
      setCopyStatus('Kunde inte kopiera');
      setTimeout(() => setCopyStatus(''), 2000);
    }
  };

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Join a room</h2>
      <label>
        Room
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          required
          placeholder="Room"
        />
      </label>
      <label>
        Display name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Display name"
        />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="gm">Spelledare</option>
          <option value="player">Spelare</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Kontrollerar...' : 'Enter'}
      </button>
      <div className="invite-card" aria-label="room-creator">
        <div className="invite-card__header">
          <div>
            <h3>Skapa nytt rum</h3>
            <p>Generera en delbar länk med en ny slug.</p>
          </div>
          <span className="badge">Ny</span>
        </div>
        <div className="inline-form">
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Room name (optional)"
            aria-label="room-name"
          />
          <button type="button" onClick={handleCreateRoom} disabled={creatingRoom}>
            {creatingRoom ? 'Skapar...' : 'Skapa rum'}
          </button>
        </div>
        {createError && <p className="error">{createError}</p>}
        {inviteLink && (
          <div className="invite-link">
            <label htmlFor="invite-url">Inbjudningslänk</label>
            <div className="invite-link__controls">
              <input id="invite-url" value={inviteLink} readOnly />
              <button type="button" className="ghost-button" onClick={handleCopyInvite}>
                {copyStatus || 'Kopiera'}
              </button>
            </div>
            <p className="invite-link__hint">Dela länken så landar spelare direkt i rummet via sluggen.</p>
          </div>
        )}
      </div>
    </form>
  );
};

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
  defaultRoom: PropTypes.string,
  onRoomChange: PropTypes.func.isRequired,
  buildInviteUrl: PropTypes.func,
};

export default Login;
