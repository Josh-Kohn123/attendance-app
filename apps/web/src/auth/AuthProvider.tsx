import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, clearToken } from "../api/client";

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    position: string | null;
    department: string | null;
    site: string;
    daysOff: string[];
  } | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  login: () => void;
  logout: () => void;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAdmin: false,
  isManager: false,
  login: () => {},
  logout: () => {},
  refetchUser: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = React.useCallback(() => {
    // If there's no token there's nothing to validate — skip the request entirely.
    // Without this guard, /auth/me is called on every page load (including /login)
    // with no credentials, which produces a noisy 401 in the console and makes it
    // look like an automatic sign-in attempt is happening.
    if (!localStorage.getItem("auth_token")) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    api
      .get<User>("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // Check URL for token from OAuth callback (fallback for hard-redirect flow)
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setToken(token);
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetchUser();
  }, [fetchUser]);

  const login = () => {
    window.location.href = "/api/auth/google";
  };

  const logout = () => {
    clearToken();
    setUser(null);
    window.location.href = "/login";
  };

  const isAdmin = user?.roles.includes("admin") ?? false;
  const isManager = user?.roles.includes("manager") ?? false;

  return (
    <AuthContext.Provider value={{ user, isLoading, isAdmin, isManager, login, logout, refetchUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
