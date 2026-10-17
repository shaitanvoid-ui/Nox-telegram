import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Fingerprint, LockKeyhole, Save } from "lucide-react";
import type { AuditEvent, Page, Settings } from "../types";
import { api, formatDate, json } from "../api";
import { useChatQuery, useWorkspace } from "../workspace";
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  SectionHeading,
} from "../components/ui";
import "../styles/advanced-pages.css";

export function SettingsPage() {
  const query = useChatQuery<Settings>("settings");
  const { chat } = useWorkspace();
  if (query.isPending) return <Loading label="Загружаем настройки" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  return <SettingsForm key={chat.id} initial={query.data} />;
}
function SettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { chat, token } = useWorkspace();
  const client = useQueryClient();
  const audit = useChatQuery<Page<AuditEvent>>("audit");
  const mutation = useMutation({
    mutationFn: () =>
      api<Settings>(
        `/chats/${chat.id}/settings`,
        token,
        json("PATCH", {
          title: form.title,
          welcome_message: form.welcome_message,
          warn_limit: form.warn_limit,
          privacy_retention_days: form.privacy_retention_days,
        }),
      ),
    onSuccess: (data) => {
      client.setQueryData(["chat", chat.id, "settings"], data);
      setForm(data);
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["chats"] });
      void client.invalidateQueries({ queryKey: ["chat", chat.id, "audit"] });
    },
  });
  function change(patch: Partial<Settings>) {
    setForm((value) => ({ ...value, ...patch }));
    setSaved(false);
  }
  return (
    <div className="page-enter ap-page">
      <PageHeader
        eyebrow="06 / WORKSPACE CONTROL"
        title="Настройки"
        description="Параметры сообщества, права доступа и политика хранения данных."
      />
      <form
        className="ap-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <section className="ap-setting-section panel">
          <div className="ap-setting-heading">
            <span className="ap-index">01</span>
            <h2>Сообщество</h2>
            <p>Название и реакция на события.</p>
          </div>
          <div className="ap-setting-fields">
            <Field label="Название чата">
              <input
                required
                minLength={2}
                maxLength={128}
                value={form.title}
                onChange={(event) => change({ title: event.target.value })}
              />
            </Field>
            <Field
              label="Приветственное сообщение"
              hint="Используется сценарием приветствия в Astra Studio."
            >
              <textarea
                required
                maxLength={1000}
                rows={4}
                value={form.welcome_message}
                onChange={(event) =>
                  change({ welcome_message: event.target.value })
                }
              />
            </Field>
            <Field
              label="Лимит предупреждений"
              hint="Порог автоматической эскалации в модерации."
            >
              <input
                required
                type="number"
                min={1}
                max={20}
                value={form.warn_limit}
                onChange={(event) =>
                  change({ warn_limit: Number(event.target.value) })
                }
              />
            </Field>
          </div>
        </section>
        <section className="ap-setting-section panel">
          <div className="ap-setting-heading">
            <span className="ap-index">02</span>
            <h2>Приватность</h2>
            <p>Управляйте сроком хранения событий.</p>
            <Fingerprint size={70} strokeWidth={0.7} aria-hidden="true" />
          </div>
          <div className="ap-setting-fields">
            <Field
              label="Хранение событий, дней"
              hint="Срок хранения журналов и контекста сообщений. Системные и финансовые записи регулируются отдельно."
            >
              <input
                required
                type="number"
                min={7}
                max={365}
                value={form.privacy_retention_days}
                onChange={(event) =>
                  change({ privacy_retention_days: Number(event.target.value) })
                }
              />
            </Field>
            <div className="ap-access-info">
              <LockKeyhole size={19} />
              <div>
                <strong>Доступ проверяется сервером</strong>
                <p>
                  Каждое изменение записывается в аудит. Права Telegram не
                  выдаются через Mini App.
                </p>
              </div>
            </div>
            <dl className="ap-access-list">
              <div>
                <dt>Контроль доступа</dt>
                <dd>RBAC</dd>
              </div>
              <div>
                <dt>Ваша роль</dt>
                <dd>
                  {{
                    owner: "Владелец",
                    admin: "Администратор",
                    moderator: "Модератор",
                  }[chat.role] ?? chat.role}
                </dd>
              </div>
            </dl>
          </div>
        </section>
        {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
        {saved && <Notice>Настройки сохранены.</Notice>}
        <div className="ap-save-bar">
          <p>Изменения применяются после сохранения.</p>
          <Button type="submit" loading={mutation.isPending}>
            <Save size={16} />
            Сохранить изменения
          </Button>
        </div>
      </form>
      <section className="panel ap-history">
        <SectionHeading
          title="Журнал аудита"
          meta="Последние 20 действий администраторов и системных правил."
        >
          <ArrowUpRight size={21} />
        </SectionHeading>
        {audit.isPending ? (
          <Loading label="Загружаем аудит" />
        ) : audit.isError ? (
          <ErrorState error={audit.error} retry={() => void audit.refetch()} />
        ) : !audit.data.items.length ? (
          <Empty
            title="Журнал пока пуст"
            description="После первого изменения здесь появятся детали действия и его автор."
          />
        ) : (
          <ol className="ap-journal">
            {audit.data.items.slice(0, 20).map((event) => (
              <li key={event.id}>
                <span className="ap-journal-mark">
                  <Fingerprint size={17} />
                </span>
                <div>
                  <strong>{event.action}</strong>
                  <p>{event.detail}</p>
                  <small>{event.actor_name}</small>
                </div>
                <time dateTime={event.created_at}>
                  {formatDate(event.created_at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
