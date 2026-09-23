import { useEffect, useRef } from 'react';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Google's identity script only wants initialize() called once per page
// load — calling it again (e.g. after navigating from Login to
// Register, both of which render this button) logs a warning and, worse,
// only the *first* call's callback stays wired up. This module-level
// indirection keeps init to exactly once while still routing each
// credential response to whichever button is currently mounted.
let initialized = false;
let currentCallback = null;
function dispatchCredential(response) {
  currentCallback?.(response.credential);
}

// Renders Google's own "Sign in with Google" button via the Google
// Identity Services script (loaded in index.html). On success, Google
// hands back a signed credential (a JWT) proving the person controls
// that Google account — onCredential passes it straight to our backend,
// which verifies it server-side rather than trusting the client.
export default function GoogleButton({ onCredential, text = 'signin_with' }) {
  const divRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    currentCallback = onCredential;

    function render() {
      if (!window.google?.accounts?.id || !divRef.current) return;
      if (!initialized) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: dispatchCredential,
          // Without FedCM, Google's script falls back to a popup +
          // window.postMessage handshake to deliver the credential back
          // to this page. Browsers that restrict cross-window messaging
          // under a strict Cross-Origin-Opener-Policy can silently drop
          // that message — the console shows a COOP/postMessage warning,
          // and from the user's side the button just does nothing: no
          // credential ever arrives, no error, they're just left sitting
          // on the login page. FedCM is Google's own recommended fix —
          // it uses a native browser-mediated exchange instead of
          // postMessage, so there's nothing for COOP to block.
          use_fedcm_for_prompt: true,
        });
        initialized = true;
      }
      window.google.accounts.id.renderButton(divRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text,
      });
    }

    if (window.google?.accounts?.id) {
      render();
      return;
    }
    // The GIS script loads async — if it isn't ready yet, wait for it.
    const script = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    script?.addEventListener('load', render, { once: true });
    return () => script?.removeEventListener('load', render);
  }, [onCredential, text]);

  if (!GOOGLE_CLIENT_ID) return null;

  return <div ref={divRef} className="google-button-slot" />;
}
