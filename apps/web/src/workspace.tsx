import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Chat } from "./types";
interface Workspace {
  chat: Chat;
  token: string;
  mode: string;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace missing");
  return value;
}
export function useChatQuery<T>(
  resource: string,
  params?: Record<string, string | number>,
) {
  const { chat, token } = useWorkspace();
  return useQuery({
    queryKey: params
      ? ["chat", chat.id, resource, params]
      : ["chat", chat.id, resource],
    queryFn: () =>
      api<T>(
        `/chats/${chat.id}/${resource}${
          params
            ? "?" +
              new URLSearchParams(
                Object.entries(params)
                  .filter(([, value]) => value !== "")
                  .map(([key, value]) => [key, String(value)]),
              )
            : ""
        }`,
        token,
      ),
  });
}
