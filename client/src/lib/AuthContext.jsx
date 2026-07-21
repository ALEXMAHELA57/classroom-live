import { createContext, useContext, useEffect, useState } from 'react';
import * as authApi from './auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.fetchMe().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  async function login(creds) {
    const u = await authApi.login(creds);
    setUser(u);
    return u;
  }

  function logout() {
    authApi.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
