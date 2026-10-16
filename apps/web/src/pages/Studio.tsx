import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  Braces,
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
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="NOX STUDIO / AUTOMATION"
        title="Меньше рутины. Больше идей"
        description="Соберите поведение NOX из понятных событий, условий и действий."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus size={17} />
            Создать сценарий
          </Button>
        }
      />
      <section className="studio-intro panel">
        <div className="studio-intro-copy">
          <Badge tone="violet">
            <Workflow size={12} />
            AUTOMATION, SIMPLIFIED
          </Badge>
          <h2>
            Ваши правила.
            <br />
            <span>Идеальное исполнение.</span>
          </h2>
          <p>
            NOX реагирует на события, проверяет условия и выполняет разрешённое
            действие.
          </p>
        </div>
        <div className="flow-demo" aria-label="Событие, условие, действие">
          <div>
            <Radio size={23} />
            <span>Событие</span>
            <small>Что произошло?</small>
          </div>
          <ArrowRight size={18} className="flow-arrow" />
          <div>
            <GitBranch size={23} />
            <span>Условие</span>
            <small>Когда реагировать?</small>
          </div>
          <ArrowRight size={18} className="flow-arrow" />
          <div>
            <Zap size={23} />
            <span>Действие</span>
            <small>Что сделать?</small>
          </div>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Ваши сценарии</h2>
          <p>Приоритет определяет порядок выполнения.</p>
        </div>
        <Badge>{query.data?.total ?? 0} сценариев</Badge>
      </div>
      {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.items.length ? (
        <section className="panel">
          <Empty
            title="Первый шаг к свободе от рутины"
            description="Создайте сценарий приветствия, защиты от флуда или эскалации предупреждений."
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus size={16} />
                Создать сценарий
              </Button>
            }
          />
        </section>
      ) : (
        <div className="rules-list">
          {query.data.items.map((rule) => (
            <section className="panel rule-card" key={rule.id}>
              <div className="rule-card-top">
                <div className="quick-icon violet">
                  <Workflow size={21} />
                </div>
                <div>
                  <h2>{rule.name}</h2>
                  <span>
                    Приоритет {rule.priority} · {formatNumber(rule.executions)}{" "}
                    выполнений
                  </span>
                </div>
                <Switch
                  checked={rule.enabled}
                  disabled={mutation.isPending}
                  label={`Включить сценарий ${rule.name}`}
                  onChange={(enabled) =>
                    mutation.mutate({ id: rule.id, enabled })
                  }
                />
              </div>
              <div className="rule-flow">
                <span>
                  <Radio size={14} />
                  {triggers[rule.trigger]}
                </span>
                <ArrowRight size={14} />
                <span>
                  <Braces size={14} />
                  {rule.conditions.threshold
                    ? `Порог ≥ ${rule.conditions.threshold}`
                    : "Любое событие"}
                </span>
                <ArrowRight size={14} />
                <span>
                  <Zap size={14} />
                  {actions[rule.action]}
                </span>
              </div>
              <div className="rule-card-bottom">
                <Badge tone={rule.enabled ? "green" : "muted"}>
                  {rule.enabled ? "Активен" : "Приостановлен"}
                </Badge>
                <button className="text-link" onClick={() => setEditing(rule)}>
                  Открыть редактор
                  <ArrowRight size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      <section className="panel studio-history">
        <SectionHeading
          title="История выполнения"
          meta="Последние 20 выполнений сценариев"
        />
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <ErrorState
            error={history.error}
            retry={() => void history.refetch()}
          />
        ) : !history.data.items.length ? (
          <Empty
            title="Сценарии ещё не выполнялись"
            description="История появится после подходящего события. Предпросмотр не создаёт выполнение."
          />
        ) : (
          <div className="audit-list">
            {history.data.items.map((item) => (
              <div className="audit-row" key={item.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{item.rule_name}</strong>
                  <p>{item.status}</p>
                </div>
                <time>{formatDate(item.created_at)}</time>
              </div>
            ))}
          </div>
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
      description="Сначала проверьте логику в безопасном предпросмотре."
      onClose={onClose}
    >
      <form
        className="form-stack automation-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Название">
          <input
            required
            minLength={3}
            maxLength={100}
            placeholder="Например, тёплый приём"
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </Field>
        <div className="editor-node">
          <div className="editor-node-title">
            <span>
              <Radio size={16} />
              01 / СОБЫТИЕ
            </span>
            <Badge tone="violet">TRIGGER</Badge>
          </div>
          <Field label="Когда">
            <select
              disabled={Boolean(initial)}
              value={draft.trigger}
              onChange={(e) => {
                const trigger = e.target.value as Trigger;
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
        <ArrowDown size={18} className="editor-arrow" />
        <div className="editor-node">
          <div className="editor-node-title">
            <span>
              <GitBranch size={16} />
              02 / УСЛОВИЕ
            </span>
            <Badge tone="cyan">CONDITION</Badge>
          </div>
          {draft.trigger === "member_join" ? (
            <p className="muted">
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
                onChange={(e) =>
                  change({
                    conditions: {
                      ...draft.conditions,
                      threshold: Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          )}
        </div>
        <ArrowDown size={18} className="editor-arrow" />
        <div className="editor-node">
          <div className="editor-node-title">
            <span>
              <Zap size={16} />
              03 / ДЕЙСТВИЕ
            </span>
            <Badge tone="amber">ACTION</Badge>
          </div>
          <Field label="NOX должен">
            <select
              disabled={Boolean(initial)}
              value={draft.action}
              onChange={(e) => change({ action: e.target.value as Action })}
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
        </div>
        {initial && (
          <p className="muted editor-note">
            Можно изменить название, приоритет и состояние. Для другой логики
            создайте новый сценарий.
          </p>
        )}
        {draft.action === "mute" && (
          <Field label="Длительность мута, минут">
            <input
              disabled={Boolean(initial)}
              type="number"
              required
              min={1}
              max={1440}
              value={draft.conditions.duration_minutes ?? 60}
              onChange={(e) =>
                change({
                  conditions: {
                    ...draft.conditions,
                    duration_minutes: Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        )}
        <div className="form-two">
          <Field label="Приоритет">
            <input
              required
              type="number"
              min={0}
              max={100}
              value={draft.priority}
              onChange={(e) => change({ priority: Number(e.target.value) })}
            />
          </Field>
          <div className="form-toggle">
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
            {preview.explanation}{" "}
            {preview.side_effects
              ? "Результат содержит действия."
              : "Действия не выполнялись."}
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
