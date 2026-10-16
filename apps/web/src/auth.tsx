import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, json } from "./api";
import { initializeTelegram } from "./telegram";
import type { Session } from "./types";
interface Auth {
  session: Session | null;
  loading: boolean;
  error: Error | null;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const initialized = useRef(false);
  const client = useQueryClient();
  async function login(path: string, data: unknown) {
    setLoading(true);
    setError(null);
    try {
      setSession(await api<Session>(path, undefined, json("POST", data)));
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Ошибка авторизации"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const initData = initializeTelegram();
    if (initData) void login("/auth/telegram", { init_data: initData });
  }, []);
  return (
    <Context.Provider
      value={{
        session,
        loading,
        error,
        loginDemo: () => login("/auth/demo", {}),
        logout: async () => {
          try {
            if (session)
              await api("/auth/logout", session.access_token, json("POST", {}));
          } catch {
            /* Clear the local bearer even when the server cannot be reached. */
          } finally {
            setSession(null);
            client.clear();
          }
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
// Context and hook intentionally share the module to keep session state private.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error("AuthProvider missing");
  return auth;
}
