import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';

// Web Speech API is only reliably available in Chrome/Chromium browsers —
// this is a real limitation, not a bug. There's no reliable free
// cross-browser alternative; a paid speech-to-text service would be needed
// for consistent support elsewhere.
const SpeechRecognitionAPI =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function Captions({ myName }) {
  const [showOthers, setShowOthers] = useState(false); // only gates OTHER people's captions now
  const [captioningSelf, setCaptioningSelf] = useState(false);
  const [listening, setListening] = useState(false); // true once the browser confirms mic capture actually started
  const [myLine, setMyLine] = useState('');
  const [otherLines, setOtherLines] = useState({}); // name -> latest caption text
  const [captionError, setCaptionError] = useState('');
  const recognitionRef = useRef(null);
  const intentionallyOnRef = useRef(false); // avoids a stale-closure bug in onend below

  function applyOtherLine(name, text, final) {
    setOtherLines((prev) => ({ ...prev, [name]: text }));
    if (final) {
      setTimeout(() => {
        setOtherLines((prev) => {
          if (prev[name] !== text) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }, 4000);
    }
  }

  useEffect(() => {
    const socket = getSocket();
    // The server deliberately excludes the sender when relaying captions
    // (no point echoing your own words back to you over the network) — so
    // this only ever fires for OTHER people's captions, never your own.
    const onCaption = ({ name, text, final }) => applyOtherLine(name, text, final);
    socket.on('caption:text', onCaption);
    return () => socket.off('caption:text', onCaption);
  }, []);

  function toggleCaptionSelf() {
    if (!SpeechRecognitionAPI) return;
    if (captioningSelf) {
      intentionallyOnRef.current = false;
      recognitionRef.current?.stop();
      setCaptioningSelf(false);
      setListening(false);
      setMyLine('');
      return;
    }
    setCaptionError('');
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => {
      setCaptionError('');
      setListening(true); // confirms the browser actually started capturing audio for this
    };
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const text = result[0].transcript.trim();
      if (!text) return;
      // Always shown to yourself the instant it's recognized — this no
      // longer depends on a separate "show captions" toggle, since that
      // was an easy step to miss and made it look like nothing was working.
      setMyLine(text);
      if (result.isFinal) setTimeout(() => setMyLine((cur) => (cur === text ? '' : cur)), 4000);
      getSocket().emit('caption:text', { text, final: result.isFinal });
    };
    recognition.onerror = (event) => {
      intentionallyOnRef.current = false;
      setCaptioningSelf(false);
      setListening(false);
      // Common causes: 'not-allowed' (mic permission denied or blocked),
      // 'audio-capture' (no microphone found), 'no-speech' (nothing heard
      // for a while — not a real failure), 'network' (Chrome's recognition
      // service couldn't be reached).
      const messages = {
        'not-allowed': "Microphone access was denied — check your browser's site permissions.",
        'audio-capture': 'No microphone was found.',
        network: "Couldn't reach the speech recognition service — check your connection.",
        'no-speech': '', // not a real error — don't show anything, just let onend restart it
      };
      const msg = messages[event.error] ?? `Captioning stopped (${event.error}).`;
      if (msg) setCaptionError(msg);
    };
    recognition.onend = () => {
      setListening(false);
      // Browsers auto-stop recognition after a period of silence — restart
      // it if the user hasn't explicitly turned captioning off. Reads a
      // ref rather than the captioningSelf state, since this closure was
      // created once when recognition started and would otherwise always
      // see that initial (false) value.
      if (intentionallyOnRef.current) recognition.start();
    };
    intentionallyOnRef.current = true;
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setCaptioningSelf(true);
    } catch (err) {
      // start() can throw synchronously rather than firing onerror — e.g.
      // if it's called twice in quick succession. Without this, that
      // failure was completely invisible: no error box, no state change.
      intentionallyOnRef.current = false;
      setCaptionError(`Could not start captioning: ${err.message || err.name}`);
      console.error('[captions] recognition.start() threw', err);
    }
  }

  useEffect(() => {
    return () => {
      intentionallyOnRef.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  const otherEntries = Object.entries(otherLines);

  return (
    <>
      <div className="caption-controls">
        <button
          className="ghost"
          onClick={toggleCaptionSelf}
          disabled={!SpeechRecognitionAPI}
          title={!SpeechRecognitionAPI ? 'Live captioning needs Chrome — not supported in this browser' : ''}
        >
          {captioningSelf ? 'Stop captioning my speech' : 'Caption my speech'}
        </button>
        <button className="ghost" onClick={() => setShowOthers((s) => !s)}>
          {showOthers ? "Hide others' captions" : "Show others' captions"}
        </button>
      </div>
      {captionError && <p className="caption-error">{captionError}</p>}

      {captioningSelf && (
        <div className="caption-overlay">
          <p>
            <strong>{myName || 'You'}:</strong>{' '}
            {myLine || (listening ? '(listening…)' : '(starting…)')}
          </p>
        </div>
      )}

      {showOthers && otherEntries.length > 0 && (
        <div className="caption-overlay" style={{ bottom: captioningSelf ? 110 : 64 }}>
          {otherEntries.map(([name, text]) => (
            <p key={name}>
              <strong>{name}:</strong> {text}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
