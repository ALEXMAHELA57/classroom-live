import { useEffect, useState } from 'react';

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
    <div className="install-banner">
      <div className="install-banner-icon">CL</div>
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
