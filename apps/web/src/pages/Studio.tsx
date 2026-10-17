import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CirclePlay,
  GitBranch,
  Plus,
  Radio,
  Workflow,
  Zap,
} from "lucide-react";
import type {
  Action,
  Automation,
  AutomationDraft,
  AutomationExecution,
  Page,
  Preview,
  Trigger,
} from "../types";
import { api, formatDate, formatNumber, json } from "../api";
import { useChatQuery, useWorkspace } from "../workspace";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
  SectionHeading,
  Switch,
} from "../components/ui";
import "../styles/advanced-pages.css";

const triggers: Record<Trigger, string> = {
  member_join: "Новый участник",
  flood: "Обнаружен флуд",
  warnings: "Порог предупреждений",
};
const actions: Record<Action, string> = {
  welcome: "Отправить приветствие",
  delete: "Удалить сообщение",
  mute: "Временный мут",
};
const executionStatus: Record<string, string> = {
  completed: "Выполнено",
  success: "Выполнено",
  succeeded: "Выполнено",
  failed: "Ошибка",
  pending: "Ожидает",
  skipped: "Пропущено",
  unknown: "Нужна проверка",
  running: "Выполняется",
};

export function StudioPage() {
  const query = useChatQuery<Page<Automation>>("automation");
  const history = useChatQuery<Page<AutomationExecution>>(
    "automation/executions",
  );
  const { chat, token } = useWorkspace();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const mutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<Automation>(
        `/chats/${chat.id}/automation/${id}`,
        token,
        json("PATCH", { enabled }),
      ),
    onSuccess: () =>
      void client.invalidateQueries({
        queryKey: ["chat", chat.id, "automation"],
      }),
  });
  if (query.isPending) return <Loading label="Загружаем сценарии" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const active = query.data.items.filter((rule) => rule.enabled).length;
  return (
    <div className="page-enter ap-page">
      <PageHeader
        eyebrow="03 / ASTRA STUDIO"
        title="Сценарии"
        description="Событие. Условие. Действие. Настройте свою логику сообщества."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus size={17} />
            Создать сценарий
          </Button>
        }
      />
      <section
        className="ap-flow-overview panel"
        aria-label="Принцип работы автоматизации"
      >
        <div className="ap-flow-summary">
          <span className="eyebrow">AUTOMATION ENGINE</span>
          <strong>
            {String(active).padStart(2, "0")}
            <span> / {String(query.data.total).padStart(2, "0")}</span>
          </strong>
          <p>сценариев включено</p>
        </div>
        <ol className="ap-flow-steps">
          <li>
            <span>01</span>
            <Radio size={22} strokeWidth={1.4} />
            <div>
              <strong>Событие</strong>
              <p>Что произошло</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <GitBranch size={22} strokeWidth={1.4} />
            <div>
              <strong>Условие</strong>
              <p>Когда реагировать</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <Zap size={22} strokeWidth={1.4} />
            <div>
              <strong>Действие</strong>
              <p>Как ответит Astra</p>
            </div>
          </li>
        </ol>
      </section>
      <SectionHeading
        title="Ваши сценарии"
        meta="Выполняются в порядке приоритета."
      >
        <Badge>{query.data.total}</Badge>
      </SectionHeading>
      {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
      {!query.data.items.length ? (
        <section className="panel">
          <Empty
            title="Создайте первый сценарий"
            description="Приветствие, реакция на флуд или эскалация предупреждений — начните с одного события."
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus size={16} />
                Создать сценарий
              </Button>
            }
          />
        </section>
      ) : (
        <div className="ap-rules">
          {query.data.items.map((rule, index) => (
            <article className="ap-rule panel" key={rule.id}>
              <header className="ap-rule-header">
                <span className="ap-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2>{rule.name}</h2>
                  <p>
                    Приоритет {rule.priority} · {formatNumber(rule.executions)}{" "}
                    выполнений
                  </p>
                </div>
                <Switch
                  checked={rule.enabled}
                  disabled={mutation.isPending}
                  label={`Включить сценарий ${rule.name}`}
                  onChange={(enabled) =>
                    mutation.mutate({ id: rule.id, enabled })
                  }
                />
              </header>
              <div className="ap-rule-logic">
                <span>
                  <Radio size={15} />
                  {triggers[rule.trigger]}
                </span>
                <ArrowUpRight size={16} />
                <span>
                  <GitBranch size={15} />
                  {rule.conditions.threshold
                    ? `Порог ≥ ${rule.conditions.threshold}`
                    : "Каждое вступление"}
                </span>
                <ArrowUpRight size={16} />
                <span>
                  <Zap size={15} />
                  {actions[rule.action]}
                </span>
              </div>
              <footer>
                <Badge tone={rule.enabled ? "green" : "muted"}>
                  {rule.enabled ? "Активен" : "Приостановлен"}
                </Badge>
                <button className="text-link" onClick={() => setEditing(rule)}>
                  Открыть редактор
                  <ArrowUpRight size={17} />
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      <section className="panel ap-history">
        <SectionHeading
          title="История выполнения"
          meta="Последние 20 событий. Предпросмотры сюда не попадают."
        >
          <Workflow size={20} />
        </SectionHeading>
        {history.isPending ? (
          <Loading label="Загружаем историю" />
        ) : history.isError ? (
          <ErrorState
            error={history.error}
            retry={() => void history.refetch()}
          />
        ) : !history.data.items.length ? (
          <Empty
            title="Пока без выполнений"
            description="Здесь появятся результаты после первого подходящего события."
          />
        ) : (
          <ol className="ap-journal">
            {history.data.items.map((item) => (
              <li key={item.id}>
                <span className="ap-journal-mark">
                  <Workflow size={16} />
                </span>
                <div>
                  <strong>{item.rule_name}</strong>
                  <p>{executionStatus[item.status] ?? item.status}</p>
                </div>
                <time dateTime={item.created_at}>
                  {formatDate(item.created_at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
      {editing && (
        <AutomationEditor
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AutomationEditor({
  initial,
  onClose,
}: {
  initial?: Automation;
  onClose: () => void;
}) {
  const { chat, token } = useWorkspace();
  const client = useQueryClient();
  const [draft, setDraft] = useState<AutomationDraft>(
    initial
      ? {
          name: initial.name,
          trigger: initial.trigger,
          conditions: initial.conditions,
          action: initial.action,
          enabled: initial.enabled,
          priority: initial.priority,
        }
      : {
          name: "",
          trigger: "member_join",
          conditions: {},
          action: "welcome",
          enabled: true,
          priority: 50,
        },
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  function change(patch: Partial<AutomationDraft>) {
    setDraft((value) => ({ ...value, ...patch }));
    setPreview(null);
  }
  const save = useMutation({
    mutationFn: () =>
      api<Automation>(
        `/chats/${chat.id}/automation${initial ? `/${initial.id}` : ""}`,
        token,
        json(
          initial ? "PATCH" : "POST",
          initial
            ? {
                name: draft.name,
                enabled: draft.enabled,
                priority: draft.priority,
              }
            : draft,
        ),
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["chat", chat.id, "automation"],
      });
      onClose();
    },
  });
  const dryRun = useMutation({
    mutationFn: () =>
      api<Preview>(
        `/chats/${chat.id}/automation/preview`,
        token,
        json("POST", {
          trigger: draft.trigger,
          conditions: draft.conditions,
          action: draft.action,
        }),
      ),
    onSuccess: setPreview,
  });
  return (
    <Modal
      title={initial ? "Редактор сценария" : "Новый сценарий"}
      description="Проверьте логику до сохранения. Предпросмотр не выполняет действий."
      onClose={onClose}
    >
      <form
        className="form-stack ap-editor"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Название">
          <input
            required
            minLength={3}
            maxLength={100}
            placeholder="Например, приветствие участников"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </Field>
        <div className="ap-editor-node">
          <div className="ap-node-heading">
            <span>01 / СОБЫТИЕ</span>
            <Radio size={18} />
          </div>
          <Field label="Когда">
            <select
              disabled={Boolean(initial)}
              value={draft.trigger}
              onChange={(event) => {
                const trigger = event.target.value as Trigger;
                change({
                  trigger,
                  conditions: trigger === "member_join" ? {} : { threshold: 3 },
                  action:
                    trigger === "member_join"
                      ? "welcome"
                      : trigger === "flood"
                        ? "delete"
                        : "mute",
                });
              }}
            >
              {Object.entries(triggers).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ArrowDown size={17} className="ap-node-arrow" />
        <div className="ap-editor-node">
          <div className="ap-node-heading">
            <span>02 / УСЛОВИЕ</span>
            <GitBranch size={18} />
          </div>
          {draft.trigger === "member_join" ? (
            <p className="ap-editor-hint">
              При каждом новом вступлении. Дополнительные условия не требуются.
            </p>
          ) : (
            <Field
              label={
                draft.trigger === "warnings"
                  ? "Количество предупреждений"
                  : "Количество сообщений в окне флуда"
              }
            >
              <input
                disabled={Boolean(initial)}
                required
                type="number"
                min={1}
                max={1000}
                value={draft.conditions.threshold ?? 3}
                onChange={(event) =>
                  change({
                    conditions: {
                      ...draft.conditions,
                      threshold: Number(event.target.value),
                    },
                  })
                }
              />
            </Field>
          )}
        </div>
        <ArrowDown size={17} className="ap-node-arrow" />
        <div className="ap-editor-node">
          <div className="ap-node-heading">
            <span>03 / ДЕЙСТВИЕ</span>
            <Zap size={18} />
          </div>
          <Field label="Что сделает Astra">
            <select
              disabled={Boolean(initial)}
              value={draft.action}
              onChange={(event) =>
                change({ action: event.target.value as Action })
              }
            >
              {Object.entries(actions)
                .filter(([key]) =>
                  draft.trigger === "member_join"
                    ? key === "welcome"
                    : draft.trigger === "warnings"
                      ? key === "mute"
                      : ["delete", "mute"].includes(key),
                )
                .map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          {draft.action === "mute" && (
            <Field label="Длительность мута, минут">
              <input
                disabled={Boolean(initial)}
                type="number"
                required
                min={1}
                max={1440}
                value={draft.conditions.duration_minutes ?? 60}
                onChange={(event) =>
                  change({
                    conditions: {
                      ...draft.conditions,
                      duration_minutes: Number(event.target.value),
                    },
                  })
                }
              />
            </Field>
          )}
        </div>
        {initial && (
          <p className="ap-editor-hint">
            Можно изменить название, приоритет и состояние. Для другой логики
            создайте новый сценарий.
          </p>
        )}
        <div className="ap-editor-options">
          <Field label="Приоритет">
            <input
              required
              type="number"
              min={0}
              max={100}
              value={draft.priority}
              onChange={(event) =>
                change({ priority: Number(event.target.value) })
              }
            />
          </Field>
          <div className="ap-switch-label">
            <span>Включить после сохранения</span>
            <Switch
              checked={draft.enabled}
              label="Включить после сохранения"
              onChange={(enabled) => change({ enabled })}
            />
          </div>
        </div>
        {preview && (
          <Notice>
            <span className="ap-preview-result">
              <Check size={16} />
              {preview.explanation}{" "}
              {preview.side_effects
                ? "Предпросмотр описывает запланированные действия."
                : "Действия не выполнялись."}
            </span>
          </Notice>
        )}
        {(save.error || dryRun.error) && (
          <Notice error>{(save.error || dryRun.error)?.message}</Notice>
        )}
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            loading={dryRun.isPending}
            onClick={() => dryRun.mutate()}
          >
            <CirclePlay size={16} />
            Предпросмотр
          </Button>
          <Button type="submit" loading={save.isPending}>
            Сохранить сценарий
          </Button>
        </div>
      </form>
    </Modal>
  );
}
