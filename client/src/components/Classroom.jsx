import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';
import { useAuth } from '../lib/AuthContext.jsx';
import { getLivekitToken, API_BASE, uploadSelfRecording } from '../lib/api.js';
import { getToken as getLoginToken } from '../lib/auth.js';
import { getSocket } from '../lib/socket.js';
import Chat from './Chat.jsx';
import HandRaiseQueue from './HandRaiseQueue.jsx';
import Whiteboard from './Whiteboard.jsx';
import Roster from './Roster.jsx';
import Attendance from './Attendance.jsx';
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

// Three quality tiers a teacher/admin can pick between, each genuinely
// smooth to run continuously at its own bitrate — the earlier problem
// wasn't "high clarity is bad," it was forcing everyone onto the most
// demanding tier permanently regardless of their connection/device.
// Picking a lower tier isn't a fallback or a compromise; it's a real
// choice for a weak connection or an older device.
// Zoom itself stays a standard, honest proportional crop (2x = half the
// frame width/height, matching how zoom is conventionally defined) — but
// mapping the SLIDER linearly onto that meant most of its length landed
// in "loses a lot of the frame" territory, since the crop shrinks fast
// as the number climbs. This curve keeps the full 1x-10x zoom range
// available, but spends most of the slider's physical length on gentle,
// fine-grained control near 1x-3x (the common case), only reaching the
// more extreme end near the far right of the slider — good for a quick
// framing nudge and for an occasional extreme close-up alike.
const ZOOM_SLIDER_MIN = 0;
const ZOOM_SLIDER_MAX = 100;
function sliderPositionToZoom(position) {
  const t = position / ZOOM_SLIDER_MAX;
  return 1 + 9 * t * t; // 1x at position 0, 10x at position 100
}
function zoomToSliderPosition(zoom) {
  return Math.sqrt(Math.max(0, zoom - 1) / 9) * ZOOM_SLIDER_MAX;
}

const VIDEO_QUALITY_PRESETS = {
  low: {
    label: 'Data saver',
    hint: 'Best for weak connections — smooth, lower detail',
    resolution: VideoPresets.h360.resolution,
    encoding: VideoPresets.h360.encoding, // ~450 Kbps, 20fps
  },
  standard: {
    label: 'Standard',
    hint: 'Good default for most classes',
    resolution: VideoPresets.h1080.resolution,
    encoding: VideoPresets.h1080.encoding, // ~3 Mbps, 30fps
  },
  high: {
    label: 'High clarity',
    hint: 'For reading a whiteboard/page — needs a strong connection',
    resolution: VideoPresets.h2160.resolution,
    // Trading framerate down (15fps) for bitrate up puts far more data
    // behind each frame that's actually sent — sharper detail on
    // stationary text, at the cost of smoothness if the camera is
    // panned around while this tier is selected.
    encoding: { maxBitrate: 12_000_000, maxFramerate: 15 },
  },
};

export default function Classroom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState('connecting'); // connecting | connected | error | ended
  const [errorMsg, setErrorMsg] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [digitalZoom, setDigitalZoom] = useState(1);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [videoQuality, setVideoQuality] = useState('standard');
  const [switchingQuality, setSwitchingQuality] = useState(false);

  // Keeps state in sync when fullscreen is exited some way other than
  // our own button — the Escape key, browser chrome, etc.
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRef.current?.requestFullscreen();
      }
    } catch {
      // Some browsers (notably iOS Safari) don't support the Fullscreen
      // API on arbitrary elements at all — nothing useful to do beyond
      // not crashing; the button simply won't visibly do anything there.
    }
  }
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

  useEffect(() => {
    zoomLevelRef.current = digitalZoom;
  }, [digitalZoom]);

  // When there's no live session to connect to, the stage (and its
  // "Panels" toggle button) don't render at all — without this, mobile
  // users would have no way to open the drawer that holds recordings and
  // files, since that toggle only exists as part of the stage toolbar.
  useEffect(() => {
    if (status === 'error') setSidePanelOpen(true);
  }, [status]);

  // Desktops typically have exactly one camera, and tapping "Flip" there
  // is harmless — restartTrack just falls back to the same camera if no
  // other one matches the requested facingMode. Trying to pre-detect
  // camera count via enumerateDevices() turned out to be unreliable
  // across phone browsers (some under-report it even after permission
  // is granted), so it's simpler and more robust to just always offer
  // the button and let the browser's own constraint-matching handle it.
  const [handRaised, setHandRaised] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [selfRecordError, setSelfRecordError] = useState('');

  const audioContainerRef = useRef(null);
  const stageRef = useRef(null);
  const roomRef = useRef(null);
  const selfRecorderRef = useRef(null);
  // Digital-zoom pipeline: raw camera → hidden <video> → <canvas> crop →
  // published as the actual camera track. Kept as refs (not state) since
  // they're mutable engine internals the draw loop reads every frame,
  // not values that should trigger re-renders.
  const rawStreamRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const zoomCanvasRef = useRef(null);
  const zoomAnimRef = useRef(null);
  const zoomLevelRef = useRef(1);
  const publishedCanvasTrackRef = useRef(null);
  const selfRecordChunksRef = useRef([]);
  // Tracks in-flight "grace period" removals — see scheduleRemoveTile below.
  const pendingRemovalsRef = useRef(new Map());

  // Matches by participant identity + kind (camera vs screen), not just
  // trackSid — swapping between the native camera and the zoom canvas
  // (or changing video quality) republishes under a NEW trackSid, but
  // it's still logically the same tile slot. Replacing in place keeps
  // the tile COUNT stable across that swap instead of dropping then
  // re-adding an entry, which is what caused every tile in the room's
  // grid to visibly resize on a quality change or 1x zoom crossing.
  function upsertTile(tile) {
    setTiles((prev) => {
      const next = prev.filter((t) => {
        const sameSlot = t.identity === tile.identity && t.kind === tile.kind;
        if (sameSlot) {
          const pending = pendingRemovalsRef.current.get(t.sid);
          if (pending) {
            clearTimeout(pending);
            pendingRemovalsRef.current.delete(t.sid);
          }
        }
        return !sameSlot && t.sid !== tile.sid;
      });
      return [...next, tile];
    });
  }
  function removeTile(sid) {
    setTiles((prev) => prev.filter((t) => t.sid !== sid));
  }
  // A track disappearing doesn't always mean it's gone for good —
  // swapping camera<->zoom-canvas or changing video quality tears down
  // and republishes under a new sid within milliseconds. Removing the
  // tile immediately made the grid reflow (tile count briefly drops,
  // then climbs back) for that gap, visible to the whole room as tiles
  // resizing. Waiting briefly gives the republish a chance to arrive
  // and claim the same slot via upsertTile above, so a normal swap
  // never touches the grid at all — only a track that's actually gone
  // (participant left, camera turned off) ends up removed.
  function scheduleRemoveTile(sid) {
    const timeoutId = setTimeout(() => {
      removeTile(sid);
      pendingRemovalsRef.current.delete(sid);
    }, 600);
    pendingRemovalsRef.current.set(sid, timeoutId);
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
            identity: participant.identity,
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
        if (track.kind === Track.Kind.Video) scheduleRemoveTile(publication.trackSid);
        track.detach().forEach((el) => el.remove());
      });

      // Safari (and occasionally other browsers) can block audio
      // autoplay even after mic/speaker permissions are granted and
      // everything else about the connection works — the remote
      // participant genuinely is publishing audio, it's just that this
      // browser refused to let it play without a direct user gesture.
      // startAudio() (called from a click, below) resolves it.
      r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioBlocked(!r.canPlaybackAudio);
      });

      r.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.track?.kind === Track.Kind.Video) {
          upsertTile({
            sid: publication.trackSid,
            kind: publication.source === Track.Source.ScreenShare ? 'screen' : 'camera',
            label: `${user.name} (you)`,
            identity: r.localParticipant.identity,
            track: publication.track,
            isLocal: true,
          });
        }
      });
      r.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        scheduleRemoveTile(publication.trackSid);
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
        setAudioBlocked(!room.canPlaybackAudio);
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
      stopRawCapture();
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

  // Draws the current frame from the hidden raw-camera <video>, cropped
  // to whatever the current zoom level dictates, onto the canvas that
  // actually gets published. Runs every frame via requestAnimationFrame
  // — reads zoomLevelRef (not state) so changing zoom is instant and
  // never waits on a re-render or track republish.
  function drawZoomFrame() {
    const video = hiddenVideoRef.current;
    const canvas = zoomCanvasRef.current;
    if (video && canvas && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const ctx = canvas.getContext('2d');
      const zoom = zoomLevelRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      // Only crop by the zoom factor itself, centered on the source's
      // own native frame — never trim to match the canvas's aspect
      // ratio. Previously this also did a "cover" crop to force the
      // source into the canvas's 16:9 shape, which silently cut off
      // the top/bottom of any camera whose native sensor isn't 16:9
      // (common — many laptop webcams are 4:3), even before any zoom
      // was applied. Letterboxing (below) keeps the whole picture
      // instead of trimming it.
      const cropW = vw / zoom;
      const cropH = vh / zoom;
      const sx = (vw - cropW) / 2;
      const sy = (vh - cropH) / 2;

      // Fit that crop onto the canvas without distorting or cropping
      // further — "contain" scaling, centered, with letterbox bars
      // filling whatever space is left over on the shorter axis.
      const scale = Math.min(canvas.width / cropW, canvas.height / cropH);
      const drawW = cropW * scale;
      const drawH = cropH * scale;
      const dx = (canvas.width - drawW) / 2;
      const dy = (canvas.height - drawH) / 2;

      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, sx, sy, cropW, cropH, dx, dy, drawW, drawH);
    }
    zoomAnimRef.current = requestAnimationFrame(drawZoomFrame);
  }

  function stopRawCapture() {
    if (zoomAnimRef.current) {
      cancelAnimationFrame(zoomAnimRef.current);
      zoomAnimRef.current = null;
    }
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
  }

  // Publishing through the zoom canvas has real CPU cost — drawing every
  // frame (especially at 4K) on top of the normal encoder work is what
  // caused stutter once this ran unconditionally, even at 1x zoom where
  // no actual cropping was happening. Fix: only pay that cost when zoom
  // is genuinely in use. At 1x, publish the camera directly (native
  // browser capture+encode, same as before zoom existed — no canvas
  // involved, no extra overhead). Only switch onto the canvas pipeline
  // when zoom moves above 1x, and switch back off it when zoom returns
  // to 1x. This is the one function that knows how to tear down
  // whichever path was previously active and stand up whichever path
  // the new state calls for.
  async function applyCameraState({ fm = facingMode, quality = videoQuality, zoom = digitalZoom } = {}) {
    const room = roomRef.current;
    if (!room) return;

    // Tear down both paths unconditionally — simpler and more reliable
    // than tracking which one was previously active.
    stopRawCapture();
    if (publishedCanvasTrackRef.current) {
      await room.localParticipant.unpublishTrack(publishedCanvasTrackRef.current, true);
      publishedCanvasTrackRef.current = null;
    }
    await room.localParticipant.setCameraEnabled(false);

    const preset = VIDEO_QUALITY_PRESETS[quality];

    if (zoom > 1) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: fm,
          width: { ideal: preset.resolution.width },
          height: { ideal: preset.resolution.height },
        },
      });
      rawStreamRef.current = stream;

      const video = hiddenVideoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const canvas = zoomCanvasRef.current;
      canvas.width = preset.resolution.width;
      canvas.height = preset.resolution.height;

      zoomAnimRef.current = requestAnimationFrame(drawZoomFrame);

      const canvasStream = canvas.captureStream(preset.encoding.maxFramerate || 30);
      const canvasTrack = canvasStream.getVideoTracks()[0];
      await room.localParticipant.publishTrack(canvasTrack, {
        source: Track.Source.Camera,
        name: 'camera',
        videoEncoding: preset.encoding,
      });
      publishedCanvasTrackRef.current = canvasTrack;
    } else {
      await room.localParticipant.setCameraEnabled(
        true,
        { facingMode: fm, resolution: preset.resolution },
        { videoEncoding: preset.encoding }
      );
    }
  }

  async function stopCameraPipeline() {
    const room = roomRef.current;
    if (publishedCanvasTrackRef.current) {
      await room?.localParticipant.unpublishTrack(publishedCanvasTrackRef.current, true);
      publishedCanvasTrackRef.current = null;
    }
    stopRawCapture();
    await room?.localParticipant.setCameraEnabled(false);
  }

  async function toggleCam() {
    const next = !camOn;
    try {
      if (next) {
        await applyCameraState();
      } else {
        await stopCameraPipeline();
        setDigitalZoom(1);
      }
      setCamOn(next);
    } catch (err) {
      setMediaError(describeMediaError(err, 'camera'));
    }
  }

  // Switches between the three quality tiers — always a brief
  // interruption for anyone watching, since bitrate can't change on a
  // live track without republishing, regardless of which path is active.
  async function changeVideoQuality(nextQuality) {
    if (nextQuality === videoQuality) return;
    setVideoQuality(nextQuality);
    if (!camOn) return; // takes effect next time the camera turns on
    setSwitchingQuality(true);
    try {
      await applyCameraState({ quality: nextQuality });
    } catch (err) {
      setMediaError(describeMediaError(err, 'camera'));
    } finally {
      setSwitchingQuality(false);
    }
  }

  // Switches between front ("user") and back ("environment") cameras on
  // devices that have both. When on the direct (non-zoomed) path, this
  // uses restartTrack to swap the capture device on the already-
  // published track — proven more reliable across devices than a full
  // stop-and-republish cycle, which can race with the camera hardware
  // not having fully released yet on some phones. When on the canvas
  // (zoomed) path, only the raw source stream feeding the canvas needs
  // to change — the published canvas track itself stays untouched.
  async function flipCamera() {
    if (!camOn) return;
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    try {
      if (digitalZoom > 1) {
        rawStreamRef.current?.getTracks().forEach((t) => t.stop());
        const preset = VIDEO_QUALITY_PRESETS[videoQuality];
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: nextFacing,
            width: { ideal: preset.resolution.width },
            height: { ideal: preset.resolution.height },
          },
        });
        rawStreamRef.current = stream;
        hiddenVideoRef.current.srcObject = stream;
        await hiddenVideoRef.current.play().catch(() => {});
      } else {
        const room = roomRef.current;
        const publication = room?.localParticipant.getTrackPublication(Track.Source.Camera);
        const track = publication?.videoTrack;
        if (track) {
          await track.restartTrack({
            facingMode: nextFacing,
            resolution: VIDEO_QUALITY_PRESETS[videoQuality].resolution,
          });
        } else {
          await applyCameraState({ fm: nextFacing });
        }
      }
      setFacingMode(nextFacing);
    } catch (err) {
      setMediaError(describeMediaError(err, 'camera'));
    }
  }

  // Called from the zoom slider. Adjusting the level while already on
  // the canvas path (i.e. zoom staying above 1x throughout) is instant —
  // just updates the ref the draw loop reads every frame, no republish.
  // Only crossing the 1x boundary in either direction needs to actually
  // switch pipelines.
  function handleZoomChange(value) {
    const wasZoomed = digitalZoom > 1;
    const willBeZoomed = value > 1;
    setDigitalZoom(value);
    zoomLevelRef.current = value;
    if (!camOn || wasZoomed === willBeZoomed) return;
    applyCameraState({ zoom: value }).catch((err) => setMediaError(describeMediaError(err, 'camera')));
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

  async function enableAudio() {
    try {
      await roomRef.current?.startAudio();
      setAudioBlocked(!roomRef.current?.canPlaybackAudio);
    } catch {
      // If it's still blocked after trying, the banner just stays up —
      // nothing further to do without another user gesture.
    }
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
            <section className="stage" ref={stageRef}>
            <div className="stage-main">
              {tiles.length === 0 ? (
                <p className="muted">Nothing is being shared yet.</p>
              ) : (
                <div className="tile-grid" style={{ '--tile-columns': Math.ceil(Math.sqrt(tiles.length)) }}>
                  {tiles.map((t) => (
                    <VideoTile key={t.sid} tile={t} />
                  ))}
                </div>
              )}
              <div ref={audioContainerRef} style={{ display: 'none' }} />
              {/* Feeds the zoom-crop canvas below — never shown directly.
                  Deliberately NOT display:none: some browsers pause video
                  decoding/frame updates for display:none elements, which
                  would silently stall the zoom pipeline. This keeps it
                  "rendered" while being invisible and out of the way. */}
              <video
                ref={hiddenVideoRef}
                muted
                playsInline
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              />
              <canvas
                ref={zoomCanvasRef}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              />
              <Captions myName={user.name} />
              {audioBlocked && (
                <button className="audio-unlock-banner" onClick={enableAudio}>
                  🔇 Tap to enable audio — your browser blocked it from playing automatically
                </button>
              )}
              {selfRecordError && <p className="caption-error" style={{ top: 44 }}>{selfRecordError}</p>}
              {camOn && (
                <div className="zoom-control">
                  <span className="zoom-icon">🔍</span>
                  <input
                    type="range"
                    min={ZOOM_SLIDER_MIN}
                    max={ZOOM_SLIDER_MAX}
                    step="1"
                    value={zoomToSliderPosition(digitalZoom)}
                    onChange={(e) => handleZoomChange(sliderPositionToZoom(Number(e.target.value)))}
                  />
                  <span className="zoom-value">{digitalZoom.toFixed(1)}x</span>
                </div>
              )}
              {camOn && user.role !== 'student' && (
                <div className="quality-control" title={VIDEO_QUALITY_PRESETS[videoQuality].hint}>
                  <span className="zoom-icon">📶</span>
                  <select
                    value={videoQuality}
                    disabled={switchingQuality}
                    onChange={(e) => changeVideoQuality(e.target.value)}
                  >
                    {Object.entries(VIDEO_QUALITY_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  {switchingQuality && <span className="muted" style={{ fontSize: '0.7rem' }}>Switching…</span>}
                </div>
              )}
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
              {camOn && (
                <button onClick={flipCamera}>
                  <span className="ctrl-icon">🔄</span>
                  <span className="ctrl-label">Flip</span>
                </button>
              )}
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
              <button onClick={toggleFullscreen}>
                <span className="ctrl-icon">{isFullscreen ? '🗗' : '⛶'}</span>
                <span className="ctrl-label">{isFullscreen ? 'Minimize' : 'Fullscreen'}</span>
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
            {isTeacher && <Attendance roomId={roomId} />}
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
