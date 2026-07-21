import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { getRoomInfo } from '../lib/api.js';

export default function JoinRoom() {
  const { roomId } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/login?redirect=/join/${roomId}`);
      return;
    }
    getRoomInfo(roomId)
      .then((info) => setRoomName(info.name))
      .catch((err) => setError(err.message || 'This invite link is invalid or the class has ended.'));
  }, [loading, user, roomId]);

  if (loading || !user) return null;

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
