import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { storage } from "@/src/utils/storage";
import { api, AUTH_SHOP_KEY, AUTH_TOKEN_KEY, Session } from "@/src/api";

type AuthState = {
  loading: boolean;
  session: Session | null;
  login: (username: string, password: string) => Promise<void>;
  signup: (shop_name: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

type TokenRes = {
  access_token: string; shop_id: string; shop_name: string; username: string;
  role: "owner" | "counter"; display_name: string;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
      const cached = await storage.getItem<string>(AUTH_SHOP_KEY, "");
      if (token && cached) {
        try {
          setSession(JSON.parse(cached) as Session);
          const fresh = await api.get<Session>("/auth/me");
          setSession(fresh);
          await storage.setItem(AUTH_SHOP_KEY, JSON.stringify(fresh));
        } catch {
          await storage.secureRemove(AUTH_TOKEN_KEY);
          await storage.removeItem(AUTH_SHOP_KEY);
          setSession(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const persist = async (t: TokenRes) => {
    await storage.secureSet(AUTH_TOKEN_KEY, t.access_token);
    const s: Session = {
      id: t.shop_id, shop_id: t.shop_id, shop_name: t.shop_name,
      username: t.username, role: t.role, display_name: t.display_name,
    };
    await storage.setItem(AUTH_SHOP_KEY, JSON.stringify(s));
    setSession(s);
  };

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<TokenRes>("/auth/login", { username, password }, false);
    await persist(res);
  }, []);

  const signup = useCallback(async (shop_name: string, username: string, password: string) => {
    const res = await api.post<TokenRes>("/auth/signup", { shop_name, username, password }, false);
    await persist(res);
  }, []);

  const logout = useCallback(async () => {
    await storage.secureRemove(AUTH_TOKEN_KEY);
    await storage.removeItem(AUTH_SHOP_KEY);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ loading, session, login, signup, logout }), [loading, session, login, signup, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
