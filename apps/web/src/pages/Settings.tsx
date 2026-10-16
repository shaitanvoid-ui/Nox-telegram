import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import type { AuditEvent, Page, Settings } from "../types";
import { api, formatDate, json } from "../api";
import { useChatQuery, useWorkspace } from "../workspace";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  SectionHeading,
} from "../components/ui";
export function SettingsPage() {
  const query = useChatQuery<Settings>("settings");
  const { chat } = useWorkspace();
  if (query.isPending) return <Loading />;
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
    <div className="page-enter">
      <PageHeader
        eyebrow="WORKSPACE PREFERENCES"
        title="По вашим правилам"
        description="Настройки сообщества, прозрачность действий и контроль данных."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="settings-grid">
          <section className="panel settings-panel">
            <SectionHeading
              title="Сообщество"
              meta="Основные параметры рабочего пространства"
            />
            <Field label="Название чата">
              <input
                required
                minLength={2}
                maxLength={128}
                value={form.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </Field>
            <Field
              label="Приветственное сообщение"
              hint="Используется сценарием приветствия NOX Studio."
            >
              <textarea
                required
                maxLength={1000}
                rows={4}
                value={form.welcome_message}
                onChange={(e) => change({ welcome_message: e.target.value })}
              />
            </Field>
            <Field
              label="Лимит предупреждений"
              hint="При достижении лимита применяется разрешённая эскалация."
            >
              <input
                required
                type="number"
                min={1}
                max={20}
                value={form.warn_limit}
                onChange={(e) => change({ warn_limit: Number(e.target.value) })}
              />
            </Field>
          </section>
          <section className="panel settings-panel">
            <SectionHeading
              title="Приватность и доступ"
              meta="Минимум данных. Понятные полномочия."
            />
            <div className="privacy-symbol">
              <LockKeyhole size={30} strokeWidth={1.3} />
            </div>
            <Field
              label="Хранение событий, дней"
              hint="Применяется к журналам и контексту сообщений; финансовые и системные записи хранятся по отдельной политике."
            >
              <input
                required
                type="number"
                min={7}
                max={365}
                value={form.privacy_retention_days}
                onChange={(e) =>
                  change({ privacy_retention_days: Number(e.target.value) })
                }
              />
            </Field>
            <div className="permission-row">
              <ShieldCheck size={18} />
              <span>Контроль доступа</span>
              <Badge tone="green">RBAC</Badge>
            </div>
            <div className="permission-row">
              <Check size={18} />
              <span>Ваша роль</span>
              <Badge tone="violet">
                {{
                  owner: "Владелец",
                  admin: "Администратор",
                  moderator: "Модератор",
                }[chat.role] ?? chat.role}
              </Badge>
            </div>
            <p className="privacy-note">
              Каждое изменение проверяется сервером и записывается в аудит.
              Права Telegram не выдаются через Mini App.
            </p>
          </section>
        </div>
        {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
        {saved && <Notice>Настройки сохранены.</Notice>}
        <div className="settings-save">
          <span>Изменения применяются после сохранения.</span>
          <Button type="submit" loading={mutation.isPending}>
            <Save size={16} />
            Сохранить изменения
          </Button>
        </div>
      </form>
      <section className="panel audit-panel">
        <SectionHeading
          title="Журнал аудита"
          meta="Изменения, которые всегда на виду"
        >
          <BookOpen size={19} className="muted" />
        </SectionHeading>
        {audit.isPending ? (
          <Loading />
        ) : audit.isError ? (
          <ErrorState error={audit.error} retry={() => void audit.refetch()} />
        ) : !audit.data.items.length ? (
          <Empty
            title="Изменений пока нет"
            description="Здесь появятся действия администраторов и системных правил."
          />
        ) : (
          <div className="audit-list">
            {audit.data.items.slice(0, 20).map((event) => (
              <div className="audit-row" key={event.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{event.action}</strong>
                  <p>{event.detail}</p>
                  <small>{event.actor_name}</small>
                </div>
                <time>{formatDate(event.created_at)}</time>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
