import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Check,
  CircleDot,
  MessageSquare,
  Plus,
  Scale,
  X,
} from "lucide-react";
import type { Appeal, Case, Intelligence, Page } from "../types";
import { api, formatDate, json, statusNames } from "../api";
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
} from "../components/ui";
import "../styles/advanced-pages.css";

export function IntelligencePage() {
  const query = useChatQuery<Intelligence>("intelligence");
  if (query.isPending) return <Loading label="Загружаем сигналы" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  return (
    <div className="page-enter ap-page">
      <PageHeader
        eyebrow="02 / ASTRA INTELLIGENCE"
        title="Разбор сигналов"
        description="Автоматические фильтры находят повод для проверки. Решение принимает человек."
        action={
          <Badge tone={data.enabled ? "green" : "muted"}>
            {data.enabled ? "AI подключён" : "AI не подключён"}
          </Badge>
        }
      />
      <section className="panel ap-intelligence-status">
        <div className="ap-intelligence-icon" aria-hidden="true">
          <BrainCircuit size={74} strokeWidth={0.8} />
        </div>
        <div>
          <span className="eyebrow">HUMAN IN THE LOOP</span>
          <h2>
            {data.enabled
              ? "Контекст под наблюдением"
              : "Фильтры работают. AI ожидает подключения."}
          </h2>
          <p>{data.notice}</p>
          <Badge>
            Политика:{" "}
            {data.policy === "review_only" ? "ручная проверка" : data.policy}
          </Badge>
        </div>
      </section>
      <div className="ap-review-heading">
        <SectionHeading
          title="Сигналы для проверки"
          meta="Эвристическая оценка не доказывает нарушение."
        />
        <span className="ap-queue-count">
          {String(data.items.length).padStart(2, "0")}
        </span>
      </div>
      {!data.items.length ? (
        <section className="panel">
          <Empty
            title="Очередь пуста"
            description={
              data.enabled
                ? "Когда сообщение потребует внимания, оно появится здесь."
                : "Здесь появятся эвристические сигналы Astra Shield. Внешняя AI-модель не подключена; сообщения ей не отправляются."
            }
          />
        </section>
      ) : (
        <div className="ap-signals">
          {data.items.map((item, index) => (
            <article className="panel ap-signal" key={item.id}>
              <header>
                <span className="ap-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Badge tone="amber">
                  <CircleDot size={13} />
                  {item.module}
                </Badge>
                <span className="ap-signal-kind">Эвристический сигнал</span>
              </header>
              <blockquote>{item.detail}</blockquote>
              <footer>
                <div>
                  <span>Участник {item.user_id}</span>
                  <time dateTime={item.created_at}>
                    {formatDate(item.created_at)}
                  </time>
                </div>
                <span className="ap-human-review">
                  Требует проверки человеком
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
      <p className="ap-data-note">
        <Scale size={17} />
        <span>
          Сигналы требуют ручной проверки. Серьёзные наказания не назначаются по
          одной неуверенной оценке.
        </span>
      </p>
    </div>
  );
}

export function AppealsPage() {
  const query = useChatQuery<Page<Appeal>>("appeals");
  const cases = useChatQuery<Page<Case>>("cases");
  const { chat, token } = useWorkspace();
  const client = useQueryClient();
  const [create, setCreate] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [resolve, setResolve] = useState<{
    appeal: Appeal;
    status: "accepted" | "rejected";
  } | null>(null);
  const createMutation = useMutation({
    mutationFn: () =>
      api<Appeal>(
        `/chats/${chat.id}/appeals`,
        token,
        json("POST", { case_id: caseId, reason }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["chat", chat.id, "appeals"] });
      setCreate(false);
      setCaseId("");
      setReason("");
      setNotice("Апелляция передана на рассмотрение.");
    },
  });
  const resolution = useMutation({
    mutationFn: ({
      appeal,
      status,
    }: {
      appeal: Appeal;
      status: "accepted" | "rejected";
    }) =>
      api<Appeal>(
        `/chats/${chat.id}/appeals/${appeal.id}/resolve`,
        token,
        json("POST", { status }),
      ),
    onSuccess: () => {
      setResolve(null);
      setNotice(
        "Решение по апелляции сохранено. Статус наказания проверяйте в истории модерации.",
      );
      void client.invalidateQueries({ queryKey: ["chat", chat.id] });
    },
  });
  if (query.isPending) return <Loading label="Загружаем апелляции" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const pending = query.data.items.filter((appeal) =>
    ["open", "pending"].includes(appeal.status),
  ).length;
  return (
    <div className="page-enter ap-page">
      <PageHeader
        eyebrow="05 / HUMAN REVIEW"
        title="Апелляции"
        description="Возможность пересмотреть решение. С сохранением контекста и истории."
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={17} />
            Подать апелляцию
          </Button>
        }
      />
      <section className="panel ap-appeals-summary">
        <Scale size={37} strokeWidth={1} />
        <div>
          <strong>{pending}</strong>
          <span>ожидают рассмотрения</span>
        </div>
        <p>
          Решение по обращению фиксируется отдельно. Отмена наказания
          выполняется в центре модерации.
        </p>
      </section>
      {notice && <Notice>{notice}</Notice>}
      {!query.data.items.length ? (
        <section className="panel">
          <Empty
            title="Апелляций пока нет"
            description="После подачи обращения здесь появятся его причина, статус и история решения."
          />
        </section>
      ) : (
        <div className="ap-appeals">
          {query.data.items.map((item) => (
            <article className="panel ap-appeal" key={item.id}>
              <header>
                <span className="ap-journal-mark">
                  <MessageSquare size={18} />
                </span>
                <div>
                  <h2>{item.user_name}</h2>
                  <span>Дело #{item.case_id.slice(0, 8)}</span>
                </div>
                <Badge
                  tone={
                    item.status === "accepted"
                      ? "green"
                      : item.status === "rejected"
                        ? "red"
                        : "amber"
                  }
                >
                  {statusNames[item.status] ?? item.status}
                </Badge>
              </header>
              <p className="ap-appeal-reason">{item.reason}</p>
              <footer>
                <time dateTime={item.created_at}>
                  {formatDate(item.created_at)}
                </time>
                {["open", "pending"].includes(item.status) && (
                  <div>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setResolve({ appeal: item, status: "rejected" })
                      }
                    >
                      <X size={15} />
                      Отклонить
                    </Button>
                    <Button
                      onClick={() =>
                        setResolve({ appeal: item, status: "accepted" })
                      }
                    >
                      <Check size={15} />
                      Принять
                    </Button>
                  </div>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
      {create && (
        <Modal
          title="Подать апелляцию"
          description="Добавьте контекст, который поможет пересмотреть решение."
          onClose={() => setCreate(false)}
        >
          {cases.isPending ? (
            <Loading label="Загружаем действия модерации" />
          ) : cases.isError ? (
            <ErrorState
              error={cases.error}
              retry={() => void cases.refetch()}
            />
          ) : !cases.data.items.length ? (
            <Empty
              title="Нет доступных действий"
              description="Чтобы подать апелляцию, нужно выбрать действие модерации."
            />
          ) : (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate();
              }}
            >
              <Field label="Действие модерации">
                <select
                  required
                  value={caseId}
                  onChange={(event) => setCaseId(event.target.value)}
                >
                  <option value="">Выберите действие</option>
                  {cases.data.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.target_name}: {item.reason}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Причина пересмотра">
                <textarea
                  required
                  minLength={5}
                  maxLength={2000}
                  rows={4}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Почему это решение стоит пересмотреть?"
                />
              </Field>
              {createMutation.isError && (
                <Notice error>{createMutation.error.message}</Notice>
              )}
              <div className="modal-actions">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setCreate(false)}
                >
                  Отмена
                </Button>
                <Button type="submit" loading={createMutation.isPending}>
                  Отправить на рассмотрение
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
      {resolve && (
        <Modal
          title={
            resolve.status === "accepted"
              ? "Принять апелляцию?"
              : "Отклонить апелляцию?"
          }
          description={`Обращение: ${resolve.appeal.user_name}`}
          onClose={() => setResolve(null)}
        >
          <p className="ap-editor-hint">
            Решение будет зафиксировано в журнале. Отмена наказания выполняется
            отдельно в центре модерации.
          </p>
          {resolution.isError && (
            <Notice error>{resolution.error.message}</Notice>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setResolve(null)}>
              Назад
            </Button>
            <Button
              loading={resolution.isPending}
              onClick={() => resolution.mutate(resolve)}
            >
              Подтвердить решение
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
