import { ArrowDownRight, ArrowUpRight, BarChart3 } from "lucide-react";
import type { Analytics } from "../types";
import { useChatQuery } from "../workspace";
import { formatNumber } from "../api";
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  PageHeader,
  SectionHeading,
} from "../components/ui";
import { ActivityChart } from "../components/dashboard/ActivityChart";
import { GrowthChart } from "../components/charts";
import "../styles/advanced-pages.css";

const actionLabels: Record<string, string> = {
  warn: "Предупреждения",
  unwarn: "Снятие предупреждений",
  mute: "Ограничения сообщений",
  unmute: "Снятие ограничений",
  ban: "Блокировки",
  unban: "Разблокировки",
  kick: "Исключения",
};
export function AnalyticsPage() {
  const query = useChatQuery<Analytics>("analytics");
  if (query.isPending) return <Loading label="Собираем аналитику" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  const max = Math.max(...data.moderation.map((item) => item.value), 1);
  const first = data.growth[0]?.members;
  const last = data.growth.at(-1)?.members;
  const growthDelta =
    data.growth.length > 1 && first !== undefined && last !== undefined
      ? last - first
      : null;
  return (
    <div className="page-enter ap-page">
      <PageHeader
        eyebrow="04 / COMMUNITY DATA"
        title="Аналитика"
        description="Динамика сообщества в деталях. Все значения — из агрегатов вашего чата."
        action={
          <Badge>
            {data.activity.length
              ? `${data.activity.length} дней`
              : "Нет данных за период"}
          </Badge>
        }
      />
      <dl className="ap-stat-strip panel">
        <div>
          <dt>Сообщения</dt>
          <dd>{formatNumber(data.summary.messages)}</dd>
          <span>за выбранный период</span>
        </div>
        <div>
          <dt>Нарушения</dt>
          <dd>{formatNumber(data.summary.violations)}</dd>
          <span>зафиксировано движком</span>
        </div>
        <div>
          <dt>Участники</dt>
          <dd>{last === undefined ? "—" : formatNumber(last)}</dd>
          <span>
            {growthDelta === null ? (
              "нет данных для сравнения"
            ) : (
              <>
                {growthDelta >= 0 ? (
                  <ArrowUpRight size={14} />
                ) : (
                  <ArrowDownRight size={14} />
                )}
                {growthDelta > 0 ? "+" : ""}
                {formatNumber(growthDelta)} за период
              </>
            )}
          </span>
        </div>
      </dl>
      <section className="panel ap-chart-panel">
        <SectionHeading
          title="Пульс сообщества"
          meta="Сообщения и нарушения. Две независимые шкалы."
        />
        <ActivityChart data={data.activity} />
      </section>
      <div className="ap-analytics-grid">
        <section className="panel ap-chart-panel">
          <SectionHeading
            title="Рост сообщества"
            meta="Снимки количества участников по дням"
          />
          {data.growth.length ? (
            <GrowthChart data={data.growth} />
          ) : (
            <Empty
              title="Пока без снимков"
              description="График появится после накопления данных об участниках. Отсутствие снимков не означает нулевой рост."
            />
          )}
        </section>
        <section className="panel ap-distribution">
          <SectionHeading
            title="Действия модерации"
            meta="Распределение за период"
          />
          <div className="ap-distribution-total">
            <strong>
              {formatNumber(
                data.moderation.reduce((total, item) => total + item.value, 0),
              )}
            </strong>
            <span>всего действий</span>
          </div>
          {!data.moderation.length ? (
            <Empty
              title="Действий пока нет"
              description="Распределение появится после первых решений модерации."
            />
          ) : (
            <ul>
              {data.moderation.map((item, index) => (
                <li key={item.label}>
                  <div>
                    <span>{actionLabels[item.label] ?? item.label}</span>
                    <strong>{formatNumber(item.value)}</strong>
                  </div>
                  <span className="ap-distribution-track">
                    <i
                      style={{
                        width: `${(Math.max(0, item.value) / max) * 100}%`,
                        opacity: Math.max(0.35, 1 - index * 0.1),
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="ap-data-note">
        <BarChart3 size={16} />
        <span>
          {data.notice ??
            "Агрегаты могут обновляться с задержкой. Демонстрационные данные отмечены в верхней панели."}
        </span>
      </p>
    </div>
  );
}
