import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api, formatDate, formatNumber, json, statusNames } from "../api";
import { useChatQuery, useWorkspace } from "../workspace";
import type { Case, Member, Page } from "../types";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
} from "../components/ui";
import { CasesTable } from "../components/CasesTable";
import "../styles/moderation-shield.css";

const pageSize = 20;
const moderationKinds = [
  ["warn", "Предупреждение"],
  ["mute", "Ограничить сообщения"],
  ["ban", "Заблокировать"],
  ["kick", "Исключить из чата"],
  ["unwarn", "Снять предупреждение"],
  ["unmute", "Разрешить сообщения"],
  ["unban", "Разблокировать"],
] as const;
const roleNames: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  moderator: "Модератор",
  member: "Участник",
};

export function ModerationPage() {
  const [tab, setTab] = useState<"cases" | "members">("cases");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [create, setCreate] = useState(false);
  const [revoke, setRevoke] = useState<Case | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const { chat, token, mode } = useWorkspace();
  const canModerate = ["owner", "admin", "moderator"].includes(chat.role);
  const cases = useChatQuery<Page<Case>>("cases", {
    limit: pageSize,
    offset: page * pageSize,
    search: tab === "cases" ? search : "",
  });
  const members = useChatQuery<Page<Member>>("members", {
    limit: pageSize,
    offset: tab === "members" ? page * pageSize : 0,
    search: tab === "members" ? search : "",
  });
  const client = useQueryClient();
  const revocation = useMutation({
    mutationFn: (item: Case) =>
      api<Case>(
        `/chats/${chat.id}/cases/${item.id}/revoke`,
        token,
        json("POST", {}),
      ),
    onSuccess: (result) => {
      setRevoke(null);
      setNotice(caseOutcome(result, mode, true));
      void client.invalidateQueries({ queryKey: ["chat", chat.id] });
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: ["chat", chat.id, "cases"] }),
  });
  const activeQuery = tab === "cases" ? cases : members;
  const total = activeQuery.data?.total ?? 0;
  function changeTab(value: "cases" | "members") {
    setTab(value);
    setPage(0);
    setSearch("");
  }
  return (
    <div className="moderation-page page-enter">
      <PageHeader
        eyebrow="01 / MODERATION"
        title="Модерация"
        description="Каждое действие — с причиной. Каждое решение — в истории."
        action={
          <Button disabled={!canModerate} onClick={() => setCreate(true)}>
            <Plus size={18} />
            Новое действие
            <ArrowUpRight size={17} />
          </Button>
        }
      />
      {notice && <Notice error={notice.error}>{notice.message}</Notice>}
      {!canModerate && (
        <Notice>У вашей роли нет права выполнять действия модерации.</Notice>
      )}
      <div className="moderation-intro">
        <div className="moderation-figure">
          <span className="moderation-figure-label">
            <ShieldCheck size={16} />
            {tab === "cases" && search
              ? "Действий найдено"
              : "Действий в истории"}
          </span>
          <strong>{cases.data ? formatNumber(cases.data.total) : "—"}</strong>
          <span>Сохранённый контекст решений</span>
        </div>
        <div className="moderation-figure">
          <span className="moderation-figure-label">
            <Users size={16} />
            {tab === "members" && search
              ? "Участников найдено"
              : "Участников в базе"}
          </span>
          <strong>
            {members.data ? formatNumber(members.data.total) : "—"}
          </strong>
          <span>По событиям Telegram</span>
        </div>
        <Link className="moderation-appeals" to="/appeals">
          <span className="moderation-appeals-icon">
            <ArrowDownLeft size={23} />
          </span>
          <span>
            <small>ОБРАТНАЯ СВЯЗЬ</small>
            <strong>Рассмотреть апелляции</strong>
            <span>Вернуться к решению с новым контекстом</span>
          </span>
          <ArrowUpRight size={21} />
        </Link>
      </div>
      <section
        className="moderation-workbench panel"
        aria-label="Данные модерации"
      >
        <div className="moderation-toolbar">
          <div
            className="moderation-tabs"
            role="tablist"
            aria-label="Данные модерации"
          >
            <button
              type="button"
              id="moderation-cases-tab"
              role="tab"
              aria-selected={tab === "cases"}
              aria-controls="moderation-content"
              className={tab === "cases" ? "is-selected" : ""}
              onClick={() => changeTab("cases")}
            >
              История действий
            </button>
            <button
              type="button"
              id="moderation-members-tab"
              role="tab"
              aria-selected={tab === "members"}
              aria-controls="moderation-content"
              className={tab === "members" ? "is-selected" : ""}
              onClick={() => changeTab("members")}
            >
              Участники
            </button>
          </div>
          <div className="moderation-search">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Поиск участников и действий"
              placeholder={
                tab === "cases"
                  ? "Поиск по причине действия"
                  : "Поиск по имени участника"
              }
              maxLength={100}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        <div
          id="moderation-content"
          role="tabpanel"
          aria-labelledby={`moderation-${tab}-tab`}
        >
          {tab === "cases" ? (
            cases.isPending ? (
              <Loading label="Загружаем историю" />
            ) : cases.isError ? (
              <ErrorState
                error={cases.error}
                retry={() => void cases.refetch()}
              />
            ) : !cases.data.items.length && search ? (
              <Empty
                title="Ничего не найдено"
                description="Попробуйте другую причину или очистите строку поиска."
              />
            ) : (
              <CasesTable
                items={cases.data.items}
                onRevoke={
                  canModerate
                    ? (item) => {
                        revocation.reset();
                        setRevoke(item);
                      }
                    : undefined
                }
                pending={revocation.isPending}
              />
            )
          ) : members.isPending ? (
            <Loading label="Загружаем участников" />
          ) : members.isError ? (
            <ErrorState
              error={members.error}
              retry={() => void members.refetch()}
            />
          ) : !members.data.items.length ? (
            <Empty
              title="Участники не найдены"
              description={
                search
                  ? "Попробуйте другое имя или очистите строку поиска."
                  : "Astra добавляет участников по мере получения событий Telegram."
              }
            />
          ) : (
            <div className="moderation-members">
              {members.data.items.map((member) => (
                <div className="moderation-member" key={member.id}>
                  <Avatar name={member.first_name} />
                  <div className="moderation-member-name">
                    <strong>{member.first_name}</strong>
                    <span>
                      {member.username
                        ? `@${member.username}`
                        : `ID ${member.id}`}
                    </span>
                  </div>
                  <Badge tone={member.role === "member" ? "muted" : "violet"}>
                    {roleNames[member.role] ?? member.role}
                  </Badge>
                  <time dateTime={member.joined_at}>
                    {formatDate(member.joined_at)}
                  </time>
                </div>
              ))}
            </div>
          )}
        </div>
        {!activeQuery.isError && !activeQuery.isPending && (
          <div className="moderation-footer">
            <span>
              {total
                ? `${formatNumber(Math.min(page * pageSize + 1, total))}–${formatNumber(Math.min((page + 1) * pageSize, total))} из ${formatNumber(total)}`
                : "Нет записей"}
            </span>
            <div className="moderation-pagination">
              <Button
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Назад
              </Button>
              <span aria-label={`Страница ${page + 1}`}>{page + 1}</span>
              <Button
                variant="ghost"
                disabled={(page + 1) * pageSize >= total}
                onClick={() => setPage((value) => value + 1)}
              >
                Далее
              </Button>
            </div>
          </div>
        )}
      </section>
      {create && (
        <CreateCase
          members={members.data?.items ?? []}
          onClose={() => setCreate(false)}
          onCreated={(result) => {
            setCreate(false);
            setNotice(caseOutcome(result, mode));
          }}
        />
      )}
      {revoke && (
        <Modal
          title="Отменить наказание?"
          description={`Участник: ${revoke.target_name}. Причина: ${revoke.reason}`}
          onClose={() => {
            if (!revocation.isPending) setRevoke(null);
          }}
        >
          <p className="moderation-modal-copy">
            Astra повторно проверит ваши полномочия. Отмена сохранится в
            истории, а результат появится после ответа Telegram.
          </p>
          {revocation.isError && (
            <Notice error>{revocation.error.message}</Notice>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              disabled={revocation.isPending}
              onClick={() => setRevoke(null)}
            >
              Назад
            </Button>
            <Button
              loading={revocation.isPending}
              onClick={() => revocation.mutate(revoke)}
            >
              Отменить наказание
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function caseOutcome(result: Case, mode: string, revoking = false) {
  const confirmed = revoking
    ? result.status === "revoked"
    : ["applied", "active"].includes(result.status);
  if (confirmed) {
    return {
      message: revoking
        ? mode === "demo"
          ? "Наказание отменено в демонстрационной базе."
          : "Наказание отменено. История действия сохранена."
        : mode === "demo"
          ? "Действие сохранено в демонстрационной базе. Telegram не подключён."
          : "Действие выполнено. Результат доступен в истории.",
      error: false,
    };
  }
  const label = statusNames[result.status] ?? result.status;
  return {
    message: `${revoking ? "Отмена не подтверждена" : "Действие не подтверждено"}. Статус: ${label}. Проверьте историю перед повторной отправкой.`,
    error: true,
  };
}

function CreateCase({
  members,
  onClose,
  onCreated,
}: {
  members: Member[];
  onClose: () => void;
  onCreated: (result: Case) => void;
}) {
  const { chat, token } = useWorkspace();
  const client = useQueryClient();
  const [kind, setKind] = useState("warn");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("60");
  const [validation, setValidation] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () =>
      api<Case>(
        `/chats/${chat.id}/cases`,
        token,
        json("POST", {
          target_user_id: Number(target),
          kind,
          reason: reason.trim(),
          ...(["mute", "ban"].includes(kind)
            ? {
                duration_minutes:
                  kind === "ban" && duration === "0" ? null : Number(duration),
              }
            : {}),
          idempotency_key: key,
        }),
      ),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["chat", chat.id] });
      onCreated(result);
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: ["chat", chat.id, "cases"] }),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isSafeInteger(Number(target)) || Number(target) <= 0) {
      setValidation("Укажите корректный Telegram ID участника.");
      return;
    }
    if (reason.trim().length < 3) {
      setValidation("Укажите понятную причину: минимум 3 символа.");
      return;
    }
    setValidation("");
    mutation.mutate();
  }
  return (
    <Modal
      title="Новое действие"
      description="Сначала контекст. Затем решение."
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <form onSubmit={submit} className="form-stack">
        <Field label="Участник">
          <select
            disabled={mutation.isPending}
            value={
              members.some((member) => String(member.id) === target)
                ? target
                : ""
            }
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Выберите участника</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.first_name} · {member.id}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Telegram ID участника"
          hint="Можно указать ID вручную. Сервер проверит чат, полномочия и роль участника."
        >
          <input
            required
            type="number"
            min={1}
            step={1}
            value={target}
            disabled={mutation.isPending}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="Действие">
          <select
            disabled={mutation.isPending}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              if (e.target.value === "mute" && duration === "0")
                setDuration("60");
            }}
          >
            {moderationKinds.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {["mute", "ban"].includes(kind) && (
          <Field
            label="Длительность"
            hint="Временное ограничение снимает Telegram по истечении срока."
          >
            <select
              disabled={mutation.isPending}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="15">15 минут</option>
              <option value="60">1 час</option>
              <option value="1440">24 часа</option>
              <option value="10080">7 дней</option>
              {kind === "ban" && <option value="0">Постоянно</option>}
            </select>
          </Field>
        )}
        <Field
          label="Причина"
          hint="Сохранится в журнале и будет доступна при обжаловании."
        >
          <textarea
            required
            minLength={3}
            maxLength={500}
            rows={3}
            disabled={mutation.isPending}
            placeholder="Укажите причину действия"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {validation && <Notice error>{validation}</Notice>}
        {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Отмена
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Подтвердить действие
          </Button>
        </div>
      </form>
    </Modal>
  );
}
