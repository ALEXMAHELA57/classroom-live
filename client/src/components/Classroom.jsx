import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useAuth } from '../lib/AuthContext.jsx';
import { getLivekitToken, API_BASE, uploadSelfRecording } from '../lib/api.js';
import { getToken as getLoginToken } from '../lib/auth.js';
import { getSocket } from '../lib/socket.js';
import Chat from './Chat.jsx';
import HandRaiseQueue from './HandRaiseQueue.jsx';
import Whiteboard from './Whiteboard.jsx';
import Roster from './Roster.jsx';
import FileShare from './FileShare.jsx';
import Captions from './Captions.jsx';
import Recordings from './Recordings.jsx';

// Translates raw getUserMedia/getDisplayMedia errors into something a
// person can actually act on. Without this, a denied or dismissed
// permission prompt just throws an uncaught error in the console and the
// button silently does nothing — which is exactly what was happening
// before this existed.
function describeMediaError(err, device) {
  if (err?.name === 'NotAllowedError') {
    return `${device[0].toUpperCase()}${device.slice(1)} access was blocked or dismissed — check your browser's site permissions and try again.`;
  }
  if (err?.name === 'NotFoundError') {
    return `No ${device} was found on this device.`;
  }
  if (err?.name === 'NotReadableError') {
    return `Couldn't access the ${device} — it may be in use by another app.`;
  }
  return `Couldn't turn on ${device}: ${err?.message || err?.name || 'unknown error'}.`;
}

// Most mobile browsers (Android Chrome, iOS Safari) don't support screen
// sharing at all — showing the button there just guarantees a failed tap.
// Check once and hide it entirely rather than let people hit an error.
const SCREEN_SHARE_SUPPORTED =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export default function Classroom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState('connecting'); // connecting | connected | error | ended
  const [errorMsg, setErrorMsg] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const [tiles, setTiles] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [endsAt, setEndsAt] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [recordingsRefreshKey, setRecordingsRefreshKey] = useState(0);
  const [selfRecording, setSelfRecording] = useState(false);
  const [selfRecordUploading, setSelfRecordUploading] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  // When there's no live session to connect to, the stage (and its
  // "Panels" toggle button) don't render at all — without this, mobile
  // users would have no way to open the drawer that holds recordings and
  // files, since that toggle only exists as part of the stage toolbar.
  useEffect(() => {
    if (status === 'error') setSidePanelOpen(true);
  }, [status]);
  const [handRaised, setHandRaised] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [selfRecordError, setSelfRecordError] = useState('');

  const audioContainerRef = useRef(null);
  const roomRef = useRef(null);
  const selfRecorderRef = useRef(null);
  const selfRecordChunksRef = useRef([]);

  function upsertTile(tile) {
    setTiles((prev) => [...prev.filter((t) => t.sid !== tile.sid), tile]);
  }
  function removeTile(sid) {
    setTiles((prev) => prev.filter((t) => t.sid !== sid));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?redirect=/join/${roomId}`);
      return;
    }

    let cancelled = false;
    const socket = getSocket();

    // Binds the track/connection handlers to whichever Room instance is
    // currently active — factored out because the relay-retry below needs
    // to create a second Room instance if the first attempt fails, and
    // both need identical listeners.
    function attachRoomListeners(r) {
      r.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Video) {
          upsertTile({
            sid: publication.trackSid,
            kind: publication.source === Track.Source.ScreenShare ? 'screen' : 'camera',
            label: participant.name || participant.identity,
            track,
            isLocal: false,
          });
        } else if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.sid = publication.trackSid;
          audioContainerRef.current?.appendChild(el);
        }
      });

      r.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        if (track.kind === Track.Kind.Video) removeTile(publication.trackSid);
        track.detach().forEach((el) => el.remove());
      });

      r.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.track?.kind === Track.Kind.Video) {
          upsertTile({
            sid: publication.trackSid,
            kind: publication.source === Track.Source.ScreenShare ? 'screen' : 'camera',
            label: `${user.name} (you)`,
            track: publication.track,
            isLocal: true,
          });
        }
      });
      r.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        removeTile(publication.trackSid);
      });

      r.on(RoomEvent.Disconnected, () => {
        if (!cancelled) setStatus((s) => (s === 'ended' ? s : 'error'));
      });
    }

    // Some networks (school/office WiFi, some mobile carriers, strict
    // firewalls) block the direct/STUN UDP traffic WebRTC prefers, but
    // still allow traffic relayed through a TURN server. If the normal
    // connection attempt fails, retry once forcing TURN-relay-only —
    // slightly higher latency, but it's the difference between "works"
    // and "could not establish pc connection" on those networks.
    async function connectWithRelayFallback(livekitUrl, token) {
      const room = new Room();
      attachRoomListeners(room);
      roomRef.current = room;
      try {
        await room.connect(livekitUrl, token);
        return room;
      } catch (err) {
        if (cancelled) throw err;
        console.warn('[classroom] direct connection failed, retrying with TURN relay only', err);
        room.disconnect();
        const relayRoom = new Room({ rtcConfig: { iceTransportPolicy: 'relay' } });
        attachRoomListeners(relayRoom);
        roomRef.current = relayRoom;
        await relayRoom.connect(livekitUrl, token);
        return relayRoom;
      }
    }

    (async () => {
      try {
        const {
          token,
          livekitUrl,
          isTeacher: teacherFlag,
          endsAt: sessionEndsAt,
        } = await getLivekitToken(roomId);
        if (cancelled) return;
        setIsTeacher(teacherFlag);
        setEndsAt(sessionEndsAt);
        if (teacherFlag) setInviteLink(`${window.location.origin}/join/${roomId}`);

        const room = await connectWithRelayFallback(livekitUrl, token);
        if (cancelled) return;
        setStatus('connected');
        socket.emit('register-identity', { identity: room.localParticipant.identity });
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err.message || 'Could not connect');
        }
      }
    })();

    socket.connect();
    socket.emit('join-room', { roomId, token: getLoginToken() });

    function onRosterCount(count) {
      setStudentCount(count);
    }
    function onServerError(msg) {
      setStatus('error');
      setErrorMsg(msg);
    }
    function onRemoved() {
      setStatus('ended');
      setErrorMsg('You were removed from the class by the teacher.');
      roomRef.current?.disconnect();
    }
    function onDeviceSuperseded() {
      setStatus('ended');
      setErrorMsg('You joined this class from another device, so this session was disconnected.');
      roomRef.current?.disconnect();
    }
    function onSessionEnded({ reason }) {
      setStatus('ended');
      setErrorMsg(reason === 'time-limit' ? 'This class\'s time limit was reached.' : 'The class has ended.');
      roomRef.current?.disconnect();
    }
    function onRecordingStatus({ recording }) {
      setIsRecording(recording);
      if (!recording) setRecordingsRefreshKey((k) => k + 1);
    }
    function onHandSubmitted() {
      setHandRaised(true);
      setTimeout(() => setHandRaised(false), 4000);
    }
    socket.on('roster:count', onRosterCount);
    socket.on('error-message', onServerError);
    socket.on('removed', onRemoved);
    socket.on('device:superseded', onDeviceSuperseded);
    socket.on('session:ended', onSessionEnded);
    socket.on('recording:status', onRecordingStatus);
    socket.on('hand:submitted', onHandSubmitted);

    return () => {
      cancelled = true;
      socket.off('roster:count', onRosterCount);
      socket.off('error-message', onServerError);
      socket.off('removed', onRemoved);
      socket.off('device:superseded', onDeviceSuperseded);
      socket.off('session:ended', onSessionEnded);
      socket.off('recording:status', onRecordingStatus);
      socket.off('hand:submitted', onHandSubmitted);
      if (selfRecorderRef.current?.state === 'recording') selfRecorderRef.current.stop();
      roomRef.current?.disconnect();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, authLoading, user]);

  // Countdown display, purely cosmetic — the server enforces the actual
  // cutoff independently of whether this tab's timer drifts.
  useEffect(() => {
    if (!endsAt) return;
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (err) {
      setMediaError(describeMediaError(err, 'microphone'));
    }
  }
  async function toggleCam() {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
    } catch (err) {
      setMediaError(describeMediaError(err, 'camera'));
    }
  }
  async function toggleScreenShare() {
    const room = roomRef.current;
    if (!room) return;
    if (!SCREEN_SHARE_SUPPORTED) {
      setMediaError("This browser doesn't support screen sharing — try a desktop browser instead.");
      return;
    }
    const next = !screenOn;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
    } catch (err) {
      setMediaError(describeMediaError(err, 'screen share'));
    }
  }

  // Records the student's own mic/camera — reuses whichever of those is
  // currently published to LiveKit rather than requesting a separate
  // getUserMedia stream, so it captures exactly what's actually on right
  // now. This is a personal recording distinct from the room-level
  // session recording; it's uploaded and stored separately.
  function toggleSelfRecording() {
    if (selfRecording) {
      selfRecorderRef.current?.stop();
      return;
    }
    const room = roomRef.current;
    if (!room) return;
    setSelfRecordError('');

    const mediaTracks = [];
    room.localParticipant.audioTrackPublications.forEach((pub) => {
      if (pub.track?.mediaStreamTrack) mediaTracks.push(pub.track.mediaStreamTrack);
    });
    room.localParticipant.videoTrackPublications.forEach((pub) => {
      if (pub.track?.mediaStreamTrack && pub.source !== Track.Source.ScreenShare) {
        mediaTracks.push(pub.track.mediaStreamTrack);
      }
    });
    if (mediaTracks.length === 0) {
      setSelfRecordError('Turn on your mic or camera first, then start recording yourself.');
      return;
    }

    let recorder;
    try {
      const stream = new MediaStream(mediaTracks);
      recorder = new MediaRecorder(stream);
    } catch (err) {
      setSelfRecordError(`Could not start recording: ${err.message || err.name}`);
      return;
    }
    selfRecordChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) selfRecordChunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      setSelfRecording(false);
      const blob = new Blob(selfRecordChunksRef.current, { type: recorder.mimeType || 'video/webm' });
      selfRecordChunksRef.current = [];
      if (blob.size === 0) return;
      setSelfRecordUploading(true);
      try {
        await uploadSelfRecording(blob);
      } catch (err) {
        setSelfRecordError(err.message);
      } finally {
        setSelfRecordUploading(false);
      }
    };
    recorder.start();
    selfRecorderRef.current = recorder;
    setSelfRecording(true);
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      window.prompt('Copy this link:', inviteLink);
    }
  }

  function endClassForEveryone() {
    if (!window.confirm('End this class for everyone? All students will be disconnected immediately.')) {
      return;
    }
    getSocket().emit('session:end');
  }

  function raiseHandQuick() {
    getSocket().emit('hand:raise', { question: '' });
  }

  async function toggleRecording() {
    setRecordingBusy(true);
    setRecordingError('');
    try {
      const path = isRecording ? 'stop' : 'start';
      const res = await fetch(`${API_BASE}/api/rooms/${roomId}/recording/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getLoginToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recording request failed');
      setIsRecording(!isRecording);
    } catch (err) {
      setRecordingError(err.message);
    } finally {
      setRecordingBusy(false);
    }
  }

  if (authLoading || !user) return null;

  return (
    <div className="classroom">
      <header className="classroom-header">
        <div>
          <strong>Classroom</strong>{' '}
          <span className="muted">— {isTeacher ? 'you are the teacher' : user.name}</span>
          <span className="muted"> · {studentCount} student{studentCount === 1 ? '' : 's'} joined</span>
          {remaining !== null && (
            <span className="muted"> · {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} left</span>
          )}
          {isRecording && <span className="rec-indicator"> ● REC</span>}
        </div>
        <div className="header-actions">
          {isTeacher && (
            <button className="ghost" onClick={toggleRecording} disabled={recordingBusy}>
              {isRecording ? 'Stop recording' : 'Start recording'}
            </button>
          )}
          {isTeacher && inviteLink && (
            <button className="ghost" onClick={copyInvite} title={inviteLink}>
              {copied ? 'Copied ✓' : 'Copy invite link'}
            </button>
          )}
          {isTeacher && (
            <button className="ghost danger" onClick={endClassForEveryone}>
              End class for everyone
            </button>
          )}
          <button className="ghost" onClick={() => navigate('/')}>
            Leave
          </button>
        </div>
      </header>
      {recordingError && <p className="error center-pad-sm">{recordingError}</p>}
      {mediaError && <p className="error center-pad-sm">{mediaError}</p>}

      {status === 'connecting' && <p className="muted center-pad">Connecting…</p>}
      {status === 'ended' && <p className="error center-pad">{errorMsg}</p>}
      {status === 'error' && (
        <p className="muted center-pad">
          This class isn't live right now{errorMsg ? ` (${errorMsg})` : ''} — if you were expecting
          to join a session, check the link or ask your teacher. Recordings and files from past
          sessions are still available below, if there are any.
        </p>
      )}

      {status !== 'ended' && (
        <main className="classroom-grid">
          {(status === 'connecting' || status === 'connected') && (
            <section className="stage">
            <div className="stage-main">
              {tiles.length === 0 ? (
                <p className="muted">Nothing is being shared yet.</p>
              ) : (
                <div className="tile-grid">
                  {tiles.map((t) => (
                    <VideoTile key={t.sid} tile={t} />
                  ))}
                </div>
              )}
              <div ref={audioContainerRef} style={{ display: 'none' }} />
              <Captions myName={user.name} />
              {selfRecordError && <p className="caption-error" style={{ top: 44 }}>{selfRecordError}</p>}
            </div>
            <div className="stage-controls">
              <button onClick={toggleMic}>
                <span className="ctrl-icon">{micOn ? '🎤' : '🔇'}</span>
                <span className="ctrl-label">{micOn ? 'Mute' : 'Unmute'}</span>
              </button>
              <button onClick={toggleCam}>
                <span className="ctrl-icon">{camOn ? '📷' : '🚫'}</span>
                <span className="ctrl-label">{camOn ? 'Stop video' : 'Start video'}</span>
              </button>
              {SCREEN_SHARE_SUPPORTED && (
                <button onClick={toggleScreenShare}>
                  <span className="ctrl-icon">🖥️</span>
                  <span className="ctrl-label">{screenOn ? 'Stop share' : 'Share'}</span>
                </button>
              )}
              {user.role === 'student' && (
                <button onClick={raiseHandQuick} disabled={handRaised}>
                  <span className="ctrl-icon">✋</span>
                  <span className="ctrl-label">{handRaised ? 'Hand up' : 'Raise hand'}</span>
                </button>
              )}
              {user.role === 'student' && (
                <button
                  onClick={() => {
                    if (sidePanelOpen && chatOpen) {
                      setSidePanelOpen(false);
                    } else {
                      setChatOpen(true);
                      setSidePanelOpen(true);
                    }
                  }}
                >
                  <span className="ctrl-icon">💬</span>
                  <span className="ctrl-label">{sidePanelOpen && chatOpen ? 'Close' : 'Chat'}</span>
                </button>
              )}
              <button className="panel-toggle-btn" onClick={() => setSidePanelOpen((o) => !o)}>
                <span className="ctrl-icon">{sidePanelOpen ? '✕' : '🗂️'}</span>
                <span className="ctrl-label">{sidePanelOpen ? 'Close' : 'Panels'}</span>
              </button>
              <button onClick={() => navigate('/')}>
                <span className="ctrl-icon">🚪</span>
                <span className="ctrl-label">Leave</span>
              </button>
            </div>
            </section>
          )}

          {sidePanelOpen && <div className="side-panel-backdrop" onClick={() => setSidePanelOpen(false)} />}
          <aside className={`side-panel ${sidePanelOpen ? 'open' : ''}`}>
            <div className="side-panel-top">
              <div className="side-panel-handle" onClick={() => setSidePanelOpen(false)} />
              <button className="side-panel-close" onClick={() => setSidePanelOpen(false)}>
                ✕ Close
              </button>
            </div>
            {isTeacher && <Roster />}
            {isTeacher ? <HandRaiseQueue /> : <HandRaiseButton />}
            <Whiteboard isTeacher={isTeacher} />
            <FileShare roomId={roomId} isTeacher={isTeacher} />
            {user.role === 'superadmin' && (
              <Recordings roomId={roomId} refreshKey={recordingsRefreshKey} />
            )}
            <Chat name={user.name} open={chatOpen} onOpenChange={setChatOpen} />
          </aside>
        </main>
      )}
    </div>
  );
}

function VideoTile({ tile }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && tile.track) tile.track.attach(el);
    return () => {
      if (el) tile.track?.detach(el);
    };
  }, [tile.track]);

  return (
    <div className="tile">
      <video ref={ref} autoPlay playsInline muted={tile.isLocal} />
      <span className="tile-label">
        {tile.label} {tile.kind === 'screen' ? '· screen' : ''}
      </span>
    </div>
  );
}

function HandRaiseButton() {
  const [question, setQuestion] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    const onSubmitted = () => setSent(true);
    socket.on('hand:submitted', onSubmitted);
    return () => socket.off('hand:submitted', onSubmitted);
  }, []);

  function raiseHand(e) {
    e.preventDefault();
    getSocket().emit('hand:raise', { question });
    setQuestion('');
    setTimeout(() => setSent(false), 3000);
  }

  return (
    <form className="panel" onSubmit={raiseHand}>
      <h3>Raise hand</h3>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Your question (optional)"
      />
      <button type="submit">{sent ? 'Sent ✓' : 'Raise hand'}</button>
    </form>
  );
}
