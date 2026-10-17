export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
async function request<T>(
  url: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Не удалось связаться с Astra API. Проверьте подключение и повторите попытку.",
    );
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    let message =
      response.status === 403
        ? "У вашей роли нет доступа к этому действию."
        : response.status === 401
          ? "Сессия истекла. Войдите повторно."
          : response.status === 429
            ? "Слишком много запросов. Подождите немного."
            : "Не удалось выполнить запрос. Попробуйте ещё раз.";
    if (data && typeof data === "object") {
      if ("detail" in data && typeof data.detail === "string")
        message = data.detail;
      if (
        "error" in data &&
        data.error &&
        typeof data.error === "object" &&
        "message" in data.error &&
        typeof data.error.message === "string"
      )
        message = data.error.message;
      else if (
        "error" in data &&
        data.error &&
        typeof data.error === "object" &&
        "message" in data.error &&
        data.error.message &&
        typeof data.error.message === "object" &&
        "message" in data.error.message &&
        typeof data.error.message.message === "string"
      )
        message = data.error.message.message;
    }
    throw new ApiError(response.status, message);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
export function api<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  return request<T>(`/api/v1${path}`, token, options);
}
export function getHealth(): Promise<{ status: string; mode: string }> {
  return request("/health");
}
export function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}
export const number = new Intl.NumberFormat("ru-RU");
export const formatNumber = (value: number) => number.format(value);
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const caseNames: Record<string, string> = {
  warn: "Предупреждение",
  mute: "Мут",
  ban: "Блокировка",
  kick: "Исключение",
  unban: "Разблокировка",
  unmute: "Снятие мута",
  unwarn: "Снятие предупреждения",
};
export const statusNames: Record<string, string> = {
  unknown: "Нужна проверка",
  revoking: "Отменяется",
  active: "Активно",
  pending: "В очереди",
  processing: "Выполняется",
  applied: "Применено",
  revoked: "Отменено",
  expired: "Истекло",
  failed: "Ошибка",
  accepted: "Принята",
  rejected: "Отклонена",
  open: "На рассмотрении",
};
