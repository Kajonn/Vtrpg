import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';

const Login = ({ onLogin, defaultRoom, onRoomChange }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('gm');
  const [room, setRoom] = useState(defaultRoom || 'alpha');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [createdRoom, setCreatedRoom] = useState(null);
  const [copyStatus, setCopyStatus] = useState('');

  const inviteUrl = useMemo(() => {
    if (!createdRoom?.slug && !createdRoom?.id) return '';
    return `${window.location.origin}/room/${createdRoom.slug || createdRoom.id}`;
  }, [createdRoom]);

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

    onLogin({ name, role }, room);
    onRoomChange?.(room);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setCreateError('');
    setCopyStatus('');
    const trimmedName = roomName.trim();
    const trimmedCreator = creatorName.trim();
    if (!trimmedCreator) {
      setCreateError('Ange ditt namn för att skapa ett rum.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, createdBy: trimmedCreator }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Kunde inte skapa rummet.');
      }
      setCreatedRoom(payload);
      const nextRoom = payload.slug || payload.id;
      if (nextRoom) {
        setRoom(nextRoom);
        onRoomChange?.(nextRoom);
      }
      setName((prev) => prev || trimmedCreator);
      setRole('gm');
    } catch (err) {
      setCreateError(err.message || 'Kunde inte skapa rummet.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('Länken kopierades.');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch (err) {
      setCopyStatus('Kunde inte kopiera länken.');
    }
  };

  return (
    <div className="card login-layout">
      <form className="card__section" onSubmit={handleSubmit}>
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
      </form>

      <form className="card__section" onSubmit={handleCreate}>
        <h2>Skapa nytt rum</h2>
        <label>
          Rumnamn (valfritt)
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Ex: Kvällsäventyr"
          />
        </label>
        <label>
          Ditt namn
          <input
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
            required
            placeholder="Ex: Spelledare"
          />
        </label>
        {createError && <p className="error">{createError}</p>}
        <button type="submit" disabled={creating}>
          {creating ? 'Skapar...' : 'Skapa rum'}
        </button>

        {createdRoom && (
          <div className="invite-box">
            <p className="muted">
              Rum skapades. Dela länken för spelare att ansluta:
            </p>
            <div className="invite-link">
              <code>{inviteUrl}</code>
              <button type="button" onClick={handleCopyInvite} className="ghost-button">
                Kopiera länk
              </button>
            </div>
            {copyStatus && <p className="muted">{copyStatus}</p>}
          </div>
        )}
      </form>
    </div>
  );
};

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
  defaultRoom: PropTypes.string,
  onRoomChange: PropTypes.func,
};

export default Login;
