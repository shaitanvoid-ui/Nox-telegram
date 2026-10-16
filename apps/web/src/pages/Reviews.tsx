import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Check,
  Eye,
  Fingerprint,
  MessageSquare,
  Plus,
  Scale,
  ShieldCheck,
  Sparkles,
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
export function IntelligencePage() {
  const query = useChatQuery<Intelligence>("intelligence");
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="NOX INTELLIGENCE / CONTEXT MATTERS"
        title="Контекст важнее совпадений"
        description="Интеллектуальный слой с понятными границами и правом на пересмотр."
        action={
          <Badge tone={data.enabled ? "green" : "muted"}>
            {data.enabled ? "Анализ включён" : "Провайдер не подключён"}
          </Badge>
        }
      />
      <section className="intelligence-hero panel">
        <div className="intelligence-symbol">
          <BrainCircuit size={54} strokeWidth={1.2} />
          <span />
          <span />
        </div>
        <div>
          <Badge tone="violet">
            <Sparkles size={12} />
            HUMAN IN CONTROL
          </Badge>
          <h2>
            Помощник.
            <br />
            <span>С правом сомневаться.</span>
          </h2>
          <p>{data.notice}</p>
        </div>
      </section>
      <div className="policy-grid">
        <section className="panel policy-card">
          <Eye size={25} />
          <h3>Сначала — проверка</h3>
          <p>Неуверенная оценка направляется на ручное рассмотрение.</p>
        </section>
        <section className="panel policy-card">
          <ShieldCheck size={25} />
          <h3>Предсказуемые границы</h3>
          <p>Серьёзное наказание не назначается по одной неуверенной оценке.</p>
        </section>
        <section className="panel policy-card">
          <Fingerprint size={25} />
          <h3>Меньше данных</h3>
          <p>
            Контекст передаётся только подключённому провайдеру по политике
            сообщества.
          </p>
        </section>
      </div>
      <section className="panel">
        <SectionHeading
          title="Очередь проверок"
          meta={`Политика: ${data.policy === "review_only" ? "ручная проверка" : data.policy}`}
        />
        <div className="intelligence-queue">
          {!data.items.length ? (
            <Empty
              title={
                data.enabled
                  ? "Очередь пуста"
                  : "Интеллектуальный слой ожидает подключения"
              }
              description={
                data.enabled
                  ? "Здесь появятся сообщения, которым требуется внимание модератора."
                  : "AI-провайдер не настроен. Обычные фильтры NOX Shield продолжают работать; сообщения не отправляются внешней модели."
              }
            />
          ) : (
            data.items.map((item) => (
              <article className="review-item" key={item.id}>
                <Badge tone="amber">Эвристический сигнал · {item.module}</Badge>
                <blockquote>{item.detail}</blockquote>
                <p>
                  Участник {item.user_id} · {formatDate(item.created_at)}
                </p>
                <span className="muted">
                  Эвристическая оценка требует проверки человеком.
                </span>
              </article>
            ))
          )}
        </div>
      </section>
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
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="FAIRNESS / APPEALS"
        title="Каждый голос имеет значение"
        description="Пересматривайте решения открыто, сохраняя историю и контекст."
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={17} />
            Подать апелляцию
          </Button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <section className="appeals-principle panel">
        <Scale size={28} strokeWidth={1.4} />
        <p>
          Справедливая модерация допускает пересмотр. Решение по апелляции
          сохраняется отдельно от истории наказания.
        </p>
        <Badge tone="violet">HUMAN REVIEW</Badge>
      </section>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.items.length ? (
        <section className="panel">
          <Empty
            title="Апелляций пока нет"
            description="Новые обращения участников появятся здесь после подачи."
          />
        </section>
      ) : (
        <div className="appeals-list">
          {query.data.items.map((item) => (
            <section className="panel appeal-card" key={item.id}>
              <div className="appeal-top">
                <span className="quick-icon violet">
                  <MessageSquare size={20} />
                </span>
                <div>
                  <h2>{item.user_name}</h2>
                  <small>Дело #{String(item.case_id).slice(0, 8)}</small>
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
              </div>
              <p>{item.reason}</p>
              <div className="appeal-bottom">
                <time>{formatDate(item.created_at)}</time>
                {["open", "pending"].includes(item.status) && (
                  <div>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setResolve({ appeal: item, status: "rejected" })
                      }
                    >
                      <X size={14} />
                      Отклонить
                    </Button>
                    <Button
                      onClick={() =>
                        setResolve({ appeal: item, status: "accepted" })
                      }
                    >
                      <Check size={14} />
                      Принять
                    </Button>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {create && (
        <Modal
          title="Подать апелляцию"
          description="Объясните, почему решение стоит пересмотреть."
          onClose={() => setCreate(false)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
          >
            <Field label="Действие модерации">
              <select
                required
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
              >
                <option value="">Выберите действие</option>
                {cases.data?.items.map((item) => (
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
                onChange={(e) => setReason(e.target.value)}
                placeholder="Добавьте важный контекст и объясните свою позицию."
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
          <p className="modal-copy muted">
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
