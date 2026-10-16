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
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Switch,
} from "../components/ui";
const configurable = new Set([
  "anti_spam",
  "anti_flood",
  "anti_raid",
  "anti_duplicate",
  "anti_mention",
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
  const client = useQueryClient();
  const [editing, setEditing] = useState<ShieldModule | null>(null);
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
    },
  });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const enabled = query.data.modules.filter((module) => module.enabled).length;
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="NOX SHIELD / SECURITY LAYER"
        title="Спокойствие по умолчанию"
        description="Независимые модули, точные настройки. Защита под вашим контролем."
        action={
          <Badge tone="green">
            <span className="tiny-dot green" />
            {enabled} / {query.data.modules.length} активно
          </Badge>
        }
      />
      <section className="shield-summary panel">
        <div className="shield-summary-icon">
          <ShieldCheck size={33} strokeWidth={1.3} />
        </div>
        <div>
          <h2>Многослойная защита</h2>
          <p>
            Изменения применяются к новым событиям. Администраторы и исключения
            проверяются перед каждым действием.
          </p>
        </div>
        <div className="protection-meter">
          <span>
            <strong>
              {Math.round(
                (enabled / Math.max(1, query.data.modules.length)) * 100,
              )}
              %
            </strong>
            покрытие
          </span>
          <div>
            <i
              style={{
                width: `${(enabled / Math.max(1, query.data.modules.length)) * 100}%`,
              }}
            />
          </div>
        </div>
      </section>
      {mutation.isError && <Notice error>{mutation.error.message}</Notice>}
      <div className="module-grid">
        {query.data.modules.map((module) => {
          const Icon = icons[module.key] ?? ShieldCheck;
          return (
            <section
              className={`module-card panel ${module.enabled ? "module-enabled" : ""}`}
              key={module.key}
            >
              <div className="module-card-top">
                <span className="module-icon">
                  <Icon size={23} strokeWidth={1.5} />
                </span>
                <Switch
                  label={`Включить ${module.name}`}
                  checked={module.enabled}
                  disabled={mutation.isPending}
                  onChange={(enabledValue) =>
                    mutation.mutate({ key: module.key, enabled: enabledValue })
                  }
                />
              </div>
              <h2>{module.name}</h2>
              <p>{module.description}</p>
              <div className="module-card-bottom">
                <span>
                  <i
                    className={`tiny-dot ${module.enabled ? "green" : "muted"}`}
                  />
                  {module.enabled
                    ? `${formatNumber(module.events)} срабатываний`
                    : "Выключен"}
                </span>
                {configurable.has(module.key) && (
                  <button
                    className="icon-button"
                    aria-label={`Настройки ${module.name}`}
                    onClick={() => setEditing(module)}
                  >
                    <Settings2 size={17} />
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <section className="emergency-panel panel">
        <div className="quick-icon amber">
          <Siren size={24} />
        </div>
        <div>
          <h2>Emergency Mode</h2>
          <p>
            {query.data.emergency_enabled
              ? "Автоматическая защита от всплесков включена администратором."
              : "Автоматические ограничения при рейде требуют предварительного разрешения владельца. Массовое вступление само по себе не является причиной наказания."}
          </p>
        </div>
        <Badge tone={query.data.emergency_enabled ? "amber" : "muted"}>
          {query.data.emergency_enabled ? "Разрешён" : "Не разрешён"}
        </Badge>
      </section>
      {editing && (
        <ModuleEditor
          key={editing.key}
          module={editing}
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setEditing(null)}
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
      description="Настройте чувствительность фильтра под активность сообщества."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(sensitivity);
        }}
      >
        <Field
          label={`Чувствительность: ${sensitivity}`}
          hint="Более высокое значение усиливает фильтрацию. Проверьте журнал после изменения."
        >
          <input
            aria-label="Чувствительность"
            type="range"
            min={1}
            max={100}
            step={1}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
          />
        </Field>
        <p className="muted">{module.description}</p>
        {error && <Notice error>{error.message}</Notice>}
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
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
