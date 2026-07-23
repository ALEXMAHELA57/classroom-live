import { useEffect, useRef } from 'react';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Renders Google's own "Sign in with Google" button via the Google
// Identity Services script (loaded in index.html). On success, Google
// hands back a signed credential (a JWT) proving the person controls
// that Google account — onCredential passes it straight to our backend,
// which verifies it server-side rather than trusting the client.
export default function GoogleButton({ onCredential, text = 'signin_with' }) {
  const divRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    function render() {
      if (!window.google?.accounts?.id || !divRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => onCredential(response.credential),
      });
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
