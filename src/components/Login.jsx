import { useState } from 'react';
import PropTypes from 'prop-types';

const Login = ({ onLogin, defaultRoom, onRoomChange }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('gm');
  const [room, setRoom] = useState(defaultRoom || 'alpha');

  const handleSubmit = (event) => {
    event.preventDefault();
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
      <button type="submit">Enter</button>
    </form>
  );
};

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
  defaultRoom: PropTypes.string,
  onRoomChange: PropTypes.func.isRequired,
};

export default Login;
