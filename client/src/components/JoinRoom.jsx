import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { getRoomInfo, getPublicRoomInfo } from '../lib/api.js';

export default function JoinRoom() {
  const { roomId } = useParams();
  const { user, loading, joinAsGuest } = useAuth();
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState('');
  const [allowGuests, setAllowGuests] = useState(false);
  const [checkedPublicInfo, setCheckedPublicInfo] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [joiningAsGuest, setJoiningAsGuest] = useState(false);

  // Before deciding whether to send the visitor to /login, check
  // whether this specific room allows guests — that call has to work
  // for someone with no account at all, so it hits the unauthenticated
  // public-info endpoint rather than the normal (auth-required) one.
  useEffect(() => {
    if (loading) return;
    if (user) return;
    getPublicRoomInfo(roomId)
      .then((info) => {
        setRoomName(info.name);
        setAllowGuests(info.allowGuests);
        setCheckedPublicInfo(true);
      })
      .catch((err) => {
        setError(err.message || 'This invite link is invalid or the class has ended.');
        setCheckedPublicInfo(true);
      });
  }, [loading, user, roomId]);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    getRoomInfo(roomId)
      .then((info) => setRoomName(info.name))
      .catch((err) => setError(err.message || 'This invite link is invalid or the class has ended.'));
  }, [loading, user, roomId]);

  if (loading) return null;

  async function submitGuestName(e) {
    e.preventDefault();
    if (!guestName.trim()) return;
    setJoiningAsGuest(true);
    setError('');
    try {
      await joinAsGuest(roomId, guestName.trim());
      navigate(`/room/${roomId}`);
    } catch (err) {
      setError(err.message);
      setJoiningAsGuest(false);
    }
  }

  // Logged-in visitor: identical to the flow before guest access existed.
  if (user) {
    return (
      <div className="page centered">
        <div className="card">
          <h1>Join class</h1>
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <>
              {roomName && <p className="muted">{roomName}</p>}
              <p className="muted">Joining as {user.name}</p>
              <button onClick={() => navigate(`/room/${roomId}`)} disabled={!roomName}>
                Join
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Not logged in — wait to know whether this room even allows guests
  // before deciding what to show.
  if (!checkedPublicInfo) return null;

  if (error) {
    return (
      <div className="page centered">
        <div className="card">
          <h1>Join class</h1>
          <p className="error">{error}</p>
        </div>
      </div>
    );
  }

  if (!allowGuests) {
    navigate(`/login?redirect=/join/${roomId}`);
    return null;
  }

  return (
    <div className="page centered">
      <div className="card">
        <h1>Join class</h1>
        {roomName && <p className="muted">{roomName}</p>}
        <p className="muted">This class is open to anyone with the link — no account needed.</p>
        <form onSubmit={submitGuestName}>
          <input
            type="text"
            placeholder="Your name"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!guestName.trim() || joiningAsGuest}>
            {joiningAsGuest ? 'Joining…' : 'Join as guest'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 10 }}>
          Already have an account? <a href={`/login?redirect=/join/${roomId}`}>Log in instead</a>
        </p>
      </div>
    </div>
  );
}
