import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { api, formatDate, formatNumber, json } from "../api";
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
export function ModerationPage() {
  const [tab, setTab] = useState<"cases" | "members">("cases");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [create, setCreate] = useState(false);
  const [revoke, setRevoke] = useState<Case | null>(null);
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const cases = useChatQuery<Page<Case>>("cases", {
    limit: 20,
    offset: page * 20,
    search,
  });
  const members = useChatQuery<Page<Member>>("members", {
    limit: 20,
    offset: page * 20,
    search,
  });
  const { chat, token, mode } = useWorkspace();
  const client = useQueryClient();
  const revocation = useMutation({
    mutationFn: (item: Case) =>
      api<Case>(
        `/chats/${chat.id}/cases/${item.id}/revoke`,
        token,
        json("POST", {}),
      ),
    onSuccess: () => {
      setRevoke(null);
      setNotice(
        mode === "demo"
          ? "Наказание отменено в демонстрационной базе."
          : "Запрос на отмену принят. Итоговый статус доступен в истории.",
      );
      void client.invalidateQueries({ queryKey: ["chat", chat.id] });
    },
  });
  const filteredCases =
    cases.data?.items.filter((item) =>
      `${item.target_name} ${item.reason} ${item.target_user_id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const filteredMembers =
    members.data?.items.filter((item) =>
      `${item.first_name} ${item.username ?? ""} ${item.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="MODERATION CENTER"
        title="Порядок без шума"
        description="Участники, решения и прозрачная история каждого действия."
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={17} />
            Новое действие
          </Button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <div className="moderation-overview">
        <div className="small-stat">
          <span className="quick-icon violet">
            <ShieldCheck size={22} />
          </span>
          <div>
            <strong>{formatNumber(cases.data?.total ?? 0)}</strong>
            <span>действий в истории</span>
          </div>
        </div>
        <div className="small-stat">
          <span className="quick-icon cyan">
            <Users size={22} />
          </span>
          <div>
            <strong>{formatNumber(members.data?.total ?? 0)}</strong>
            <span>участников в базе NOX</span>
          </div>
        </div>
        <button className="appeals-link" onClick={() => navigate("/appeals")}>
          <span>
            У каждого решения есть контекст.
            <strong>Рассмотреть апелляции</strong>
          </span>
          <ArrowUpRight size={20} />
        </button>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs" role="tablist" aria-label="Данные модерации">
            <button
              role="tab"
              aria-selected={tab === "cases"}
              className={tab === "cases" ? "active" : ""}
              onClick={() => {
                setTab("cases");
                setPage(0);
              }}
            >
              История действий<Badge>{cases.data?.total ?? "—"}</Badge>
            </button>
            <button
              role="tab"
              aria-selected={tab === "members"}
              className={tab === "members" ? "active" : ""}
              onClick={() => {
                setTab("members");
                setPage(0);
              }}
            >
              Участники
            </button>
          </div>
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Поиск участников и действий"
              placeholder="Поиск по имени или причине"
              maxLength={100}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        {tab === "cases" ? (
          cases.isPending ? (
            <Loading />
          ) : cases.isError ? (
            <ErrorState
              error={cases.error}
              retry={() => void cases.refetch()}
            />
          ) : !filteredCases.length && search ? (
            <Empty
              title="Ничего не найдено"
              description="Попробуйте другое имя, ID участника или причину действия."
            />
          ) : (
            <CasesTable
              items={filteredCases}
              onRevoke={setRevoke}
              pending={revocation.isPending}
            />
          )
        ) : members.isPending ? (
          <Loading />
        ) : members.isError ? (
          <ErrorState
            error={members.error}
            retry={() => void members.refetch()}
          />
        ) : !filteredMembers.length ? (
          <Empty
            title="Участники не найдены"
            description="NOX добавляет участников в базу по мере получения событий Telegram."
          />
        ) : (
          <div className="members-list">
            {filteredMembers.map((member) => (
              <div className="member-row" key={member.id}>
                <Avatar name={member.first_name} />
                <div className="member-name">
                  <strong>{member.first_name}</strong>
                  <span>
                    {member.username
                      ? `@${member.username}`
                      : `ID ${member.id}`}
                  </span>
                </div>
                <Badge tone={member.role === "member" ? "muted" : "violet"}>
                  {{
                    owner: "Владелец",
                    admin: "Администратор",
                    moderator: "Модератор",
                    member: "Участник",
                  }[member.role] ?? member.role}
                </Badge>
                <span className="member-joined">
                  {formatDate(member.joined_at)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="table-footer">
          {search
            ? `Найдено: ${tab === "cases" ? filteredCases.length : filteredMembers.length}`
            : "История доступна только администраторам этого сообщества."}
          <div className="pagination">
            <Button
              variant="ghost"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </Button>
            <span>{page + 1}</span>
            <Button
              variant="ghost"
              disabled={
                (page + 1) * 20 >=
                (tab === "cases"
                  ? (cases.data?.total ?? 0)
                  : (members.data?.total ?? 0))
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </Button>
          </div>
        </div>
      </section>
      {create && (
        <CreateCase
          members={members.data?.items ?? []}
          onClose={() => setCreate(false)}
          onCreated={() => {
            setCreate(false);
            setNotice(
              mode === "demo"
                ? "Действие сохранено в демонстрационной базе. Telegram не подключён."
                : "Действие зарегистрировано. Проверьте статус выполнения в истории.",
            );
          }}
        />
      )}
      {revoke && (
        <Modal
          title="Отменить наказание?"
          description={`Участник: ${revoke.target_name}. Причина: ${revoke.reason}`}
          onClose={() => setRevoke(null)}
        >
          <p className="muted modal-copy">
            NOX проверит ваши полномочия и отправит запрос на отмену. История
            действия сохранится.
          </p>
          {revocation.isError && (
            <Notice error>{revocation.error.message}</Notice>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRevoke(null)}>
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
function CreateCase({
  members,
  onClose,
  onCreated,
}: {
  members: Member[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { chat, token } = useWorkspace();
  const client = useQueryClient();
  const [kind, setKind] = useState("warn");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("60");
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
          ...(kind === "mute" || kind === "ban"
            ? { duration_minutes: Number(duration) || null }
            : {}),
          idempotency_key: key,
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["chat", chat.id] });
      onCreated();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }
  return (
    <Modal
      title="Новое действие"
      description="Осознанная модерация начинается с понятной причины."
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-stack">
        <Field label="Участник">
          <select
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
          hint="Можно указать ID вручную. Сервер проверит доступ и ограничения роли."
        >
          <input
            required
            type="number"
            min={1}
            step={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="Действие">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="warn">Предупреждение</option>
            <option value="mute">Ограничить сообщения</option>
            <option value="ban">Заблокировать</option>
            <option value="kick">Исключить из чата</option>
          </select>
        </Field>
        {["mute", "ban"].includes(kind) && (
          <Field
            label="Длительность"
            hint="Для временных действий минимум 1 минута."
          >
            <select
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
            placeholder="Какое правило сообщества нарушено?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
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
