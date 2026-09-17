import { useEffect, useState } from 'react';
import logoIcon from '../assets/logo-icon.png';

const DISMISS_KEY = 'installPromptDismissedAt';
const SNOOZE_DAYS = 14;

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

function recentlyDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const elapsedDays = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
  return elapsedDays < SNOOZE_DAYS;
}

// Chrome/Android (and desktop Chrome/Edge) fire `beforeinstallprompt`, which
// we can trigger ourselves from a normal button tap. iOS Safari never fires
// that event — "Add to Home Screen" only exists behind the native Share
// sheet — so on iOS we show instructions instead of a button.
export default function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      setDeferredEvent(e);
    }
    function onInstalled() {
      setDeferredEvent(null);
      setShowIosHelp(false);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Give Chrome a moment before showing the iOS fallback so we're not
    // flashing UI the instant the page loads.
    let iosTimer;
    if (isIos()) {
      iosTimer = setTimeout(() => setShowIosHelp(true), 2500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(iosTimer);
    };
  }, []);

  // Auto-hide after a few seconds instead of sitting on screen until the
  // person taps Install or Not now — this doesn't count as a real
  // dismissal (no localStorage snooze), it just clears the banner off
  // the screen for this visit; it can show again on a later visit.
  // Fades out first rather than popping away instantly, so it doesn't
  // look like a UI glitch.
  useEffect(() => {
    if (!deferredEvent && !showIosHelp) return;
    const autoHideTimer = setTimeout(() => setFading(true), 6000);
    return () => clearTimeout(autoHideTimer);
  }, [deferredEvent, showIosHelp]);

  useEffect(() => {
    if (!fading) return;
    const removeTimer = setTimeout(() => setDismissed(true), 300);
    return () => clearTimeout(removeTimer);
  }, [fading]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  async function install() {
    if (!deferredEvent) return;
    deferredEvent.prompt();
    await deferredEvent.userChoice;
    setDeferredEvent(null);
  }

  if (dismissed || (!deferredEvent && !showIosHelp)) return null;

  return (
    <div className={`install-banner${fading ? ' install-banner--fading' : ''}`}>
      <div className="install-banner-icon"><img src={logoIcon} alt="Classroom Live" /></div>
      <div className="install-banner-body">
        <p className="install-banner-title">Install Classroom Live</p>
        {deferredEvent ? (
          <p className="install-banner-desc">Add it to your home screen for quicker access — works offline too.</p>
        ) : (
          <p className="install-banner-desc">
            Tap the Share icon <span aria-hidden="true">⎋</span>, then "Add to Home Screen".
          </p>
        )}
      </div>
      <div className="install-banner-actions">
        {deferredEvent && <button onClick={install}>Install</button>}
        <button className="ghost" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
