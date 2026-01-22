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
        const response = await fetch(`/rooms/${room}/gm`, {
          headers: {
            'Accept': 'application/json',
          },
        });
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
      setCreateError('Enter your name to create a room.');
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
        throw new Error(payload?.error || 'Could not create room.');
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
      setCreateError(err.message || 'Could not create room.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('Link copied.');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch (err) {
      setCopyStatus('Could not copy link.');
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
            <option value="gm">Game Master</option>
            <option value="player">Player</option>
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Verifying...' : 'Enter'}
        </button>
      </form>

      <form className="card__section" onSubmit={handleCreate}>
        <h2>Create new room</h2>
        <label>
          Room name (optional)
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="e.g., Evening Adventure"
          />
        </label>
        <label>
          Your name
          <input
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value)}
            required
            placeholder="e.g., Game Master"
          />
        </label>
        {createError && <p className="error">{createError}</p>}
        <button type="submit" disabled={creating}>
          {creating ? 'Creating...' : 'Create room'}
        </button>

        {createdRoom && (
          <div className="invite-box">
            <p className="muted">
              Room created. Share the link for players to join:
            </p>
            <div className="invite-link">
              <code>{inviteUrl}</code>
              <button type="button" onClick={handleCopyInvite} className="ghost-button">
                Copy link
              </button>
            </div>
            {copyStatus && <p className="muted">{copyStatus}</p>}
          </div>
        )}
      </form>

      <div className="card__section gm-login-section">
        <p className="muted">Are you a Game Master?</p>
        <a href="/gm" className="gm-login-link">Log in with your GM account →</a>
      </div>
    </div>
  );
};

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
  defaultRoom: PropTypes.string,
  onRoomChange: PropTypes.func,
};

export default Login;
