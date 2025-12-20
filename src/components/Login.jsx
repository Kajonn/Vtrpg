import { useState } from 'react';
import PropTypes from 'prop-types';

const Login = ({ onLogin, defaultRoom, onRoomChange }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('gm');
  const [room, setRoom] = useState(defaultRoom || 'alpha');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    </form>
  );
};

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
  defaultRoom: PropTypes.string,
  onRoomChange: PropTypes.func.isRequired,
};

export default Login;
