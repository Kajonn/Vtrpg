import { useCallback, useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';

const GMDashboard = ({ onJoinAsGM }) => {
  const { isAuthenticated, isLoading, loginWithRedirect, logout, user, getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newRoomName, setNewRoomName] = useState('');

  // Fetch GM's rooms
  const fetchRooms = useCallback(async () => {
    if (!isAuthenticated) return;

    setLoadingRooms(true);
    setRoomsError('');
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch('/gm/rooms', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Access denied. Make sure you have GM permissions.');
        }
        throw new Error('Failed to load rooms');
      }

      const data = await response.json();
      setRooms(data || []);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
      setRoomsError(err.message || 'Failed to load rooms');
    } finally {
      setLoadingRooms(false);
    }
  }, [isAuthenticated, getAccessTokenSilently]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchRooms();
    }
  }, [isAuthenticated, fetchRooms]);

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');

    try {
      const token = await getAccessTokenSilently();
      const response = await fetch('/gm/rooms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newRoomName.trim() || 'Untitled room' }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create room');
      }

      const room = await response.json();
      setNewRoomName('');
      setRooms((prev) => [room, ...prev]);

      // Navigate to the room as GM
      if (onJoinAsGM) {
        onJoinAsGM(room);
      } else {
        navigate(`/rooms/${room.slug}`);
      }
    } catch (err) {
      console.error('Failed to create room:', err);
      setCreateError(err.message || 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleEnterRoom = (room) => {
    if (onJoinAsGM) {
      onJoinAsGM(room);
    } else {
      navigate(`/rooms/${room.slug}`);
    }
  };

  const handleLogin = () => {
    loginWithRedirect();
  };

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  if (isLoading) {
    return (
      <div className="card gm-dashboard">
        <div className="card__section">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="card gm-dashboard">
        <div className="card__section">
          <h2>GM Login</h2>
          <p className="gm-description">
            Log in with your account to create and manage game rooms.
          </p>
          <button type="button" onClick={handleLogin} className="gm-login-button">
            Log in as Game Master
          </button>
          <p className="gm-note">
            <a href="/">← Back to player login</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card gm-dashboard">
      <div className="card__section gm-header">
        <div className="gm-user-info">
          <span>Welcome, {user?.name || user?.email || 'GM'}!</span>
          <button type="button" onClick={handleLogout} className="gm-logout-button">
            Log out
          </button>
        </div>
      </div>

      <div className="card__section">
        <h2>Create a new room</h2>
        <form onSubmit={handleCreateRoom} className="gm-create-form">
          <label>
            Room name (optional)
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="e.g., Evening Adventure"
              maxLength={100}
            />
          </label>
          {createError && <p className="error">{createError}</p>}
          <button type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create Room'}
          </button>
        </form>
      </div>

      <div className="card__section">
        <h2>Your rooms</h2>
        {roomsError && <p className="error">{roomsError}</p>}
        {loadingRooms ? (
          <p>Loading rooms...</p>
        ) : rooms.length === 0 ? (
          <p className="gm-no-rooms">You haven&apos;t created any rooms yet.</p>
        ) : (
          <ul className="gm-room-list">
            {rooms.map((room) => (
              <li key={room.id} className="gm-room-item">
                <div className="gm-room-info">
                  <span className="gm-room-name">{room.name || 'Untitled room'}</span>
                  <span className="gm-room-slug">/{room.slug}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleEnterRoom(room)}
                  className="gm-enter-button"
                >
                  Enter
                </button>
              </li>
            ))}
          </ul>
        )}
        {rooms.length > 0 && (
          <button
            type="button"
            onClick={fetchRooms}
            disabled={loadingRooms}
            className="gm-refresh-button"
          >
            {loadingRooms ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
};

GMDashboard.propTypes = {
  onJoinAsGM: PropTypes.func,
};

export default GMDashboard;
