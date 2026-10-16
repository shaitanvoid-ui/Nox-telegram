import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, json } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

describe("API boundary", () => {
  it("sends authenticated JSON to the versioned API and returns server data", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "case-1", status: "pending" })),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      api("/chats/42/cases", "session-token", json("POST", { reason: "Флуд" })),
    ).resolves.toEqual({ id: "case-1", status: "pending" });
    expect(fetch).toHaveBeenCalledWith("/api/v1/chats/42/cases", {
      method: "POST",
      body: JSON.stringify({ reason: "Флуд" }),
      headers: {
        Authorization: "Bearer session-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("preserves standardized backend errors and status for permission-aware UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "forbidden",
              message: "Недостаточно прав в этом чате",
            },
          }),
          { status: 403 },
        ),
      ),
    );
    await expect(api("/chats/42/settings")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Недостаточно прав в этом чате",
    });
  });

  it.each([
    [401, "Сессия истекла. Войдите повторно."],
    [403, "У вашей роли нет доступа к этому действию."],
    [429, "Слишком много запросов. Подождите немного."],
    [502, "Не удалось выполнить запрос. Попробуйте ещё раз."],
  ])("handles a non-JSON %i response", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>proxy error</html>", { status }),
        ),
    );
    await expect(api("/chats")).rejects.toMatchObject({ status, message });
  });

  it("does not mistake validation field arrays for a user-readable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: [{ loc: ["body", "reason"], msg: "invalid" }],
          }),
          { status: 422 },
        ),
      ),
    );
    await expect(api("/chats")).rejects.toMatchObject({
      message: "Не удалось выполнить запрос. Попробуйте ещё раз.",
    });
  });

  it("accepts an empty successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(api("/auth/logout")).resolves.toBeUndefined();
  });

  it("maps transport failures to a recoverable network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(api("/chats")).rejects.toBeInstanceOf(ApiError);
    await expect(api("/chats")).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Проверьте подключение"),
    });
  });
});
