import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useParams } from 'react-router-dom';

const JoinBySlug = ({ onJoinSuccess, existingSession }) => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);

  const loadRoom = useCallback(() => {
    if (!slug) return;
    setRoom(null);
    setLoading(true);
    setError('');
    fetch(`/rooms/slug/${slug}`, {
      headers: {
        'Accept': 'application/json',
      },
    })
      .then(async (response) => {
        if (response.ok) return response.json();
        const payload = await response.json().catch(() => ({}));
        if (response.status === 404) {
          throw new Error('Rummet kunde inte hittas.');
        }
        throw new Error(payload?.error || 'Kunde inte hämta rummet.');
      })
      .then((data) => {
        setRoom(data);
      })
      .catch((err) => {
        setError(err.message || 'Kunde inte ladda rummet.');
      })
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    if (existingSession?.roomSlug === slug || existingSession?.roomId === slug) {
      navigate(`/rooms/${existingSession.roomSlug || existingSession.roomId}`, { replace: true });
      return;
    }

    loadRoom();
  }, [slug, existingSession, navigate, loadRoom]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!slug || !name.trim()) return;
    setJoining(true);
    setError('');
    try {
      const response = await fetch('/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: name.trim(), role: 'player' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Kunde inte gå med i rummet.');
      }
      onJoinSuccess?.(payload, slug);
      navigate(`/rooms/${payload.roomSlug || slug || payload.roomId}`, { replace: true });
    } catch (err) {
      setError(err.message || 'Kunde inte gå med i rummet.');
    } finally {
      setJoining(false);
    }
  };

  const showForm = !loading && !error;
  const roomName = room?.name || 'Namnlöst rum';

  return (
    <section className="page">
      <div className="card">
        <h2>Gå med i rum</h2>
        {loading && <p>Laddar rum...</p>}
        {error && (
          <>
            <p className="error">{error}</p>
            <div className="page__actions">
              <button type="button" onClick={loadRoom} disabled={loading}>
                Försök igen
              </button>
              <button type="button" className="ghost-button" onClick={() => navigate('/')}>
                Till startsidan
              </button>
            </div>
          </>
        )}
        {showForm && (
          <>
            <p className="muted">
              Du ansluter till <strong>{roomName}</strong> ({room?.slug || slug}).
            </p>
            <form onSubmit={handleSubmit} className="page__form">
              <label>
                Ditt namn
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={32}
                  placeholder="Ange spelarnamn"
                />
              </label>
              <p className="muted">Du ansluter som spelare.</p>
              <div className="page__actions">
                <button type="submit" disabled={joining}>
                  {joining ? 'Ansluter...' : 'Gå med i rummet'}
                </button>
                <button type="button" className="ghost-button" onClick={() => navigate('/')}>
                  Till startsidan
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
};

JoinBySlug.propTypes = {
  onJoinSuccess: PropTypes.func,
  existingSession: PropTypes.shape({
    roomId: PropTypes.string,
    roomSlug: PropTypes.string,
    user: PropTypes.shape({
      name: PropTypes.string,
      role: PropTypes.string,
    }),
  }),
};

export default JoinBySlug;
