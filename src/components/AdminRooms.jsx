import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0 min';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  return `${minutes} min`;
};

const formatDate = (value) => {
  if (!value) return '–';
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch (err) {
    return '–';
  }
};

const LastUsedCell = ({ room }) => {
  if (room.active) return <span className="badge badge--active">Nu</span>;
  return formatDate(room.lastUsedAt);
};

const ActiveUsers = ({ users = [] }) => {
  if (!users.length) {
    return <span className="muted">Ingen aktiv</span>;
  }
  const gm = users.filter((user) => user.role === 'gm');
  const players = users.filter((user) => user.role !== 'gm');
  return (
    <div className="active-users">
      {gm.map((user) => (
        <span key={`gm-${user.name}`} className="badge badge--gm">
          GM: {user.name}
        </span>
      ))}
      {players.map((user) => (
        <span key={`player-${user.name}`} className="badge">
          {user.name}
        </span>
      ))}
    </div>
  );
};

const AdminRooms = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState({});

  const fetchRooms = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/admin/rooms');
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload?.error || 'Kunde inte hämta rum.');
      }
      setRooms(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setError(err.message || 'Kunde inte hämta rum.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const sortedRooms = useMemo(() => rooms.slice().sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return new Date(b.lastUsedAt || b.createdAt) - new Date(a.lastUsedAt || a.createdAt);
  }), [rooms]);

  const handleDelete = useCallback(
    async (room) => {
      if (!window.confirm(`Ta bort rummet "${room.name}"? Detta går inte att ångra.`)) return;
      setDeleting((prev) => ({ ...prev, [room.id]: true }));
      setError('');
      try {
        const response = await fetch(`/admin/rooms/${room.slug || room.id}`, { method: 'DELETE' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || 'Kunde inte ta bort rummet.');
        }
        await fetchRooms();
      } catch (err) {
        setError(err.message || 'Kunde inte ta bort rummet.');
      } finally {
        setDeleting((prev) => {
          const next = { ...prev };
          delete next[room.id];
          return next;
        });
      }
    },
    [fetchRooms],
  );

  return (
    <div className="page">
      <div className="card card--wide">
        <div className="card__header">
          <div>
            <p className="muted">Administratör</p>
            <h2>Rumöversikt</h2>
          </div>
          <div className="page__actions">
            <Link to="/" className="ghost-button">
              Tillbaka
            </Link>
            <button type="button" onClick={fetchRooms} className="ghost-button" disabled={loading}>
              Uppdatera
            </button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="muted">Laddar rum...</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Rum</th>
                  <th>Aktiva användare</th>
                  <th>Disk</th>
                  <th>Senast använd</th>
                  <th>Totalt aktiv</th>
                  <th>Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {sortedRooms.map((room) => (
                  <tr key={room.id}>
                    <td>
                      <div className="admin-room__title">
                        <strong>{room.name}</strong>
                        <p className="muted">{room.slug || room.id}</p>
                      </div>
                      {room.active && <span className="badge badge--active">Aktiv</span>}
                    </td>
                    <td>
                      <ActiveUsers users={room.activeUsers} />
                    </td>
                    <td>{formatBytes(room.diskUsageBytes)}</td>
                    <td>
                      <LastUsedCell room={room} />
                    </td>
                    <td>{formatDuration(room.totalActiveSeconds)}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-button ghost-button--danger"
                        onClick={() => handleDelete(room)}
                        disabled={deleting[room.id]}
                      >
                        {deleting[room.id] ? 'Tar bort...' : 'Ta bort'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sortedRooms.length && <p className="muted">Inga rum hittades.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminRooms;
