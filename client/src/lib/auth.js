const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const TOKEN_KEY = 'edu_platform_token';

const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
const REQUEST_TIMEOUT_MS = 20000;
const RETRY_DELAYS_MS = [3000, 6000]; // gaps between attempts 1→2 and 2→3

// The backend can take up to ~50-60s to wake up from an idle sleep
// (Render's free tier spins services down after inactivity) — this is
// confirmed by the actual symptom reported: the same backend, verified
// live and reachable, times out for some people/devices and not others
// depending purely on whether their request happened to land during
// that wake-up window. The previous version of this wrapper only had a
// single 3s-then-retry step (well under a minute of total budget), so
// it was giving up and showing an error while the server was still
// mid-boot. Three attempts with a 20s per-attempt timeout and short
// gaps between them gives roughly 20+3+20+6+20 ≈ 69s of total budget —
// comfortably past Render's worst case — while a genuinely dead
// backend still fails in bounded time instead of hanging forever.
// Lives here (not in api.js) because this is the one file everything
// else that talks to the backend already imports API_BASE from.
export async function apiFetch(url, options, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (attempt <= RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
      return apiFetch(url, options, attempt + 1);
    }
    throw new Error(NETWORK_ERROR_MESSAGE);
  } finally {
    clearTimeout(timeout);
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function parseOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function register({ name, email, password, role }) {
  const res = await apiFetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, role }),
  });
  return parseOrThrow(res);
}

export async function login({ email, password }) {
  const res = await apiFetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

export async function loginWithGoogle(credential) {
  const res = await apiFetch(`${API_BASE}/api/auth/google-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

export async function registerWithGoogle(credential, role) {
  const res = await apiFetch(`${API_BASE}/api/auth/google-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential, role }),
  });
  return parseOrThrow(res);
}

export async function joinAsGuest(roomId, name) {
  const res = await apiFetch(`${API_BASE}/api/rooms/${roomId}/guest-join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

export function logout() {
  clearToken();
}

export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  let res;
  try {
    res = await apiFetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    // apiFetch already retried once — if it's still unreachable (backend
    // waking up, brief outage, no connection), don't leave this promise
    // rejected. AuthContext calls this once on every app load with only
    // a .then(), no .catch(), so a rejection here left `loading` stuck
    // at true forever — the whole app hung on a blank screen any time
    // the backend was briefly unreachable at startup, not just this one
    // endpoint. Resolving to null instead lets the app render normally
    // (as logged-out); the stored token is deliberately left in place
    // rather than cleared, since this was a network failure, not an
    // actual invalid/expired session.
    return null;
  }
  if (!res.ok) {
    clearToken();
    return null;
  }
  const data = await res.json();
  return data.user;
}

export async function updateProfile({ name }) {
  const res = await apiFetch(`${API_BASE}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ name }),
  });
  const data = await parseOrThrow(res);
  return data.user;
}

export async function changePassword({ currentPassword, newPassword }) {
  const res = await apiFetch(`${API_BASE}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return parseOrThrow(res);
}

export { API_BASE };
