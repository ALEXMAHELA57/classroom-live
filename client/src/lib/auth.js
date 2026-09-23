const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const TOKEN_KEY = 'edu_platform_token';

const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";

// The backend can take 20-60s to wake up from an idle sleep (Render's
// free tier spins services down after inactivity), and during that
// window a request can fail outright before the server is even
// listening yet. The browser reports that as a bare "Failed to fetch"
// TypeError with no further detail -- not something anyone could act
// on if shown as-is, and left uncaught it shows up in the console as
// an unhandled promise rejection instead of any message a person would
// ever see. Every fetch call across the whole client goes through this
// instead of calling fetch directly: one retry after a short wait
// recovers the common case (server waking up mid-request); if it still
// fails, surface a message a person can actually understand rather
// than the raw browser text. Lives here (not in api.js) because this
// is the one file everything else that talks to the backend already
// imports API_BASE from.
export async function apiFetch(url, options, attempt = 1) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return apiFetch(url, options, attempt + 1);
    }
    throw new Error(NETWORK_ERROR_MESSAGE);
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
  const res = await apiFetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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
