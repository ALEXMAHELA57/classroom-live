import { useEffect, useRef, useState } from 'react';

// Independent of any LiveKit room — requests its own getUserMedia stream.
// Camera is optional: someone who just needs to speak can skip it
// entirely, or turn it off partway through (e.g. started with camera on,
// only needs audio for the rest).
export default function SelfRecorder({ onRecorded }) {
  const [status, setStatus] = useState('idle'); // idle | previewing | recording | error
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [includeCameraChoice, setIncludeCameraChoice] = useState(true); // the idle-screen checkbox
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // Attaching the stream to the <video> element has to happen in an
  // effect, not inline where the stream is created — the <video> tag only
  // exists in the DOM once `status` has already re-rendered to
  // 'previewing', so setting srcObject any earlier finds a null ref.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, status, camOn]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startPreview() {
    setError('');
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: includeCameraChoice,
        audio: true,
      });
      setStream(newStream);
      setMicOn(true);
      setCamOn(includeCameraChoice);
      setStatus('previewing');
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera/microphone access was blocked or dismissed — check your browser\'s site permissions.'
          : err.name === 'NotFoundError'
            ? 'No camera or microphone was found on this device.'
            : `Could not access camera/microphone: ${err.message || err.name}`
      );
      setStatus('error');
    }
  }

  function toggleMic() {
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }

  // Turning the camera off actually stops the video track (releasing the
  // camera/light on the device), not just hiding the preview — same as
  // "off" means in the live classroom. Works whether still previewing or
  // already recording; browsers generally pick up a track being
  // added/removed from a stream a <video> element or MediaRecorder is
  // already using without needing to restart either.
  async function toggleCam() {
    if (!stream) return;
    if (camOn) {
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      setCamOn(false);
      return;
    }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const [track] = camStream.getVideoTracks();
      stream.addTrack(track);
      setCamOn(true);
    } catch (err) {
      setError(`Could not turn camera back on: ${err.message || err.name}`);
    }
  }

  function startRecording() {
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      chunksRef.current = [];
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
      setStatus('idle');
      if (blob.size > 0) onRecorded(blob);
    };
    recorder.start();
    recorderRef.current = recorder;
    setStatus('recording');
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function cancelPreview() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setStatus('idle');
  }

  return (
    <div className="card">
      {error && <p className="error">{error}</p>}

      {status === 'idle' && (
        <label className="quiz-option" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={includeCameraChoice}
            onChange={(e) => setIncludeCameraChoice(e.target.checked)}
          />
          Include camera (uncheck to just speak, audio only)
        </label>
      )}

      {(status === 'previewing' || status === 'recording') && (
        <>
          {camOn ? (
            <video ref={videoRef} autoPlay playsInline muted className="syllabus-view" style={{ maxHeight: 320 }} />
          ) : (
            <div className="audio-only-placeholder">🎙️ Audio only — camera is off</div>
          )}
          <div className="recorder-mic-row">
            <span className={micOn ? 'mic-indicator-on' : 'mic-indicator-off'}>
              {micOn ? '🎤 Microphone on' : '🔇 Microphone muted'}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="ghost" onClick={toggleMic}>
                {micOn ? 'Mute mic' : 'Unmute mic'}
              </button>
              <button className="ghost" onClick={toggleCam}>
                {camOn ? 'Turn camera off' : 'Turn camera on'}
              </button>
            </span>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {status === 'idle' && <button onClick={startPreview}>Set up {includeCameraChoice ? 'camera & mic' : 'mic'}</button>}
        {status === 'previewing' && (
          <>
            <button onClick={startRecording}>● Start recording</button>
            <button className="ghost" onClick={cancelPreview}>Cancel</button>
          </>
        )}
        {status === 'recording' && <button onClick={stopRecording}>Stop recording</button>}
      </div>
    </div>
  );
}
