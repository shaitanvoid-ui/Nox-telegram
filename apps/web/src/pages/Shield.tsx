import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Copy,
  Fingerprint,
  Link2,
  LockKeyhole,
  MessageCircleWarning,
  Radio,
  Settings2,
  ShieldCheck,
  Siren,
  UserCheck,
  Users,
} from "lucide-react";
import type { Shield, ShieldModule } from "../types";
import { api, formatNumber, json } from "../api";
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
  Switch,
} from "../components/ui";
import "../styles/moderation-shield.css";

const configurable = new Set([
  "anti_spam",
  "anti_flood",
  "anti_raid",
  "anti_duplicate",
  "anti_mention",
]);
const reviewOnly = new Set([
  "anti_raid",
  "anti_scam",
  "anti_bot",
  "join_guard",
]);
const icons: Record<string, typeof Activity> = {
  anti_spam: MessageCircleWarning,
  anti_flood: Activity,
  anti_raid: Users,
  anti_scam: Fingerprint,
  anti_link: Link2,
  anti_duplicate: Copy,
  anti_mention: Radio,
  anti_bot: Bot,
  join_guard: UserCheck,
  edit_guard: LockKeyhole,
};

export function ShieldPage() {
  const query = useChatQuery<Shield>("shield");
  const { chat, token } = useWorkspace();
  const canConfigure = ["owner", "admin"].includes(chat.role);
  const client = useQueryClient();
  const [editing, setEditing] = useState<ShieldModule | null>(null);
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (module: Partial<ShieldModule> & { key: string }) =>
      api<Shield>(
        `/chats/${chat.id}/shield`,
        token,
        json("PATCH", { modules: [module] }),
      ),
    onSuccess: (data) => {
      client.setQueryData(["chat", chat.id, "shield"], data);
      void client.invalidateQueries({
        queryKey: ["chat", chat.id, "dashboard"],
      });
      setEditing(null);
      setNotice(
        "Настройки защиты сохранены. Они применяются к новым событиям.",
      );
    },
  });
  if (query.isPending) return <Loading label="Загружаем модули защиты" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const enabled = query.data.modules.filter((module) => module.enabled).length;
  const events = query.data.modules.reduce(
    (total, module) => total + module.events,
    0,
  );
  return (
    <div className="shield-page page-enter">
      <PageHeader
        eyebrow="02 / SHIELD"
        title="Защита сообщества"
        description="Независимые фильтры. Правила и чувствительность под вашим контролем."
        action={
          <Badge tone="muted">
            {canConfigure ? "Управление доступно" : "Только просмотр"}
          </Badge>
        }
      />
      <section
        className="shield-overview panel"
        aria-label="Состояние модулей защиты"
      >
        <div className="shield-overview-heading">
          <span className="shield-metal-icon">
            <ShieldCheck size={33} strokeWidth={1.2} />
          </span>
          <div>
            <span className="shield-overview-caption">ВКЛЮЧЕНО МОДУЛЕЙ</span>
            <h2>
              {enabled}
              <span>/ {query.data.modules.length}</span>
            </h2>
          </div>
        </div>
        <div
          className="shield-module-segments"
          aria-label={`${enabled} из ${query.data.modules.length} модулей включено`}
        >
          {query.data.modules.map((module) => (
            <i
              className={module.enabled ? "is-on" : ""}
              key={module.key}
              title={`${module.name}: ${module.enabled ? "включён" : "выключен"}`}
            />
          ))}
        </div>
        <p>
          Количество включённых фильтров. Эффективность зависит от правил,
          активности чата и прав бота.
        </p>
        <div className="shield-event-total">
          <strong>{formatNumber(events)}</strong>
          <span>срабатываний модулей</span>
        </div>
      </section>
      {!canConfigure && (
        <Notice>
          Менять настройки защиты могут владелец и администраторы. Ваша роль
          позволяет просматривать модули.
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {mutation.isError && !editing && (
        <Notice error>{mutation.error.message}</Notice>
      )}
      <div className="shield-modules-heading">
        <h2>Модули защиты</h2>
        <span>{query.data.modules.length} / INDEPENDENT FILTERS</span>
      </div>
      {!query.data.modules.length ? (
        <Empty
          title="Модули пока не настроены"
          description="Выполните настройку сообщества командой /setup в Telegram."
        />
      ) : (
        <div className="shield-module-grid">
          {query.data.modules.map((module, index) => {
            const Icon = icons[module.key] ?? ShieldCheck;
            return (
              <section
                className={`shield-module panel ${module.enabled ? "is-enabled" : ""}`}
                key={module.key}
              >
                <div className="shield-module-top">
                  <span className="shield-module-icon">
                    <Icon size={23} strokeWidth={1.4} />
                  </span>
                  <span className="shield-module-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Switch
                    label={`Включить ${module.name}`}
                    checked={module.enabled}
                    disabled={!canConfigure || mutation.isPending}
                    onChange={(value) => {
                      mutation.reset();
                      setNotice("");
                      mutation.mutate({ key: module.key, enabled: value });
                    }}
                  />
                </div>
                <div className="shield-module-copy">
                  <h3>{module.name}</h3>
                  <p>{module.description}</p>
                </div>
                <div className="shield-module-status">
                  <span
                    className={`shield-module-light ${module.enabled ? "is-on" : ""}`}
                  />
                  <span>
                    {module.enabled
                      ? reviewOnly.has(module.key)
                        ? "Сигналы для проверки"
                        : "Фильтрация включена"
                      : "Выключен"}
                  </span>
                </div>
                <div className="shield-module-bottom">
                  <span>
                    <strong>{formatNumber(module.events)}</strong> срабатываний
                  </span>
                  {configurable.has(module.key) ? (
                    <button
                      type="button"
                      className="shield-settings-button"
                      aria-label={`Настройки ${module.name}`}
                      disabled={!canConfigure || mutation.isPending}
                      onClick={() => {
                        mutation.reset();
                        setEditing(module);
                      }}
                    >
                      <Settings2 size={16} />
                      <span>Настроить</span>
                    </button>
                  ) : (
                    <span className="shield-fixed-policy">
                      По правилам модуля
                    </span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <section className="shield-emergency panel">
        <span className="shield-emergency-icon">
          <Siren size={24} strokeWidth={1.4} />
        </span>
        <div>
          <span className="shield-overview-caption">СЛЕДУЮЩИЙ ЭТАП</span>
          <h2>Emergency Mode</h2>
          <p>
            Автоматическое включение временных ограничений и восстановление
            настроек ещё не реализованы. Сигналы Anti-Raid доступны для ручного
            разбора.
          </p>
        </div>
        <Badge tone="muted">В разработке</Badge>
      </section>
      {editing && (
        <ModuleEditor
          key={editing.key}
          module={editing}
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => {
            if (!mutation.isPending) setEditing(null);
          }}
          onSave={(sensitivity) =>
            mutation.mutate({ key: editing.key, sensitivity })
          }
        />
      )}
    </div>
  );
}

function ModuleEditor({
  module,
  onClose,
  onSave,
  pending,
  error,
}: {
  module: ShieldModule;
  onClose: () => void;
  onSave: (value: number) => void;
  pending: boolean;
  error: Error | null;
}) {
  const [sensitivity, setSensitivity] = useState(module.sensitivity);
  return (
    <Modal
      title={module.name}
      description="Отрегулируйте чувствительность под активность сообщества."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            Number.isInteger(sensitivity) &&
            sensitivity >= 1 &&
            sensitivity <= 100
          )
            onSave(sensitivity);
        }}
      >
        <div className="shield-sensitivity-value">
          <strong>{sensitivity}</strong>
          <span>/ 100</span>
        </div>
        <Field
          label="Чувствительность"
          hint="Чем выше значение, тем строже фильтр. После изменения проверьте журнал срабатываний."
        >
          <input
            aria-label="Чувствительность"
            type="range"
            min={1}
            max={100}
            step={1}
            value={sensitivity}
            disabled={pending}
            onChange={(event) => setSensitivity(Number(event.target.value))}
          />
        </Field>
        <p className="shield-editor-description">{module.description}</p>
        {error && <Notice error>{error.message}</Notice>}
        <div className="modal-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            Отмена
          </Button>
          <Button loading={pending} type="submit">
            Сохранить настройки
          </Button>
        </div>
      </form>
    </Modal>
  );
}
