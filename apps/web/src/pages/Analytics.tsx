import { BarChart3, MessageSquare, ShieldCheck, Users } from "lucide-react";
import type { Analytics } from "../types";
import { useChatQuery } from "../workspace";
import { formatNumber } from "../api";
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  Metric,
  PageHeader,
  SectionHeading,
} from "../components/ui";
import { ActivityChart, GrowthChart } from "../components/charts";
export function AnalyticsPage() {
  const query = useChatQuery<Analytics>("analytics");
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  const max = Math.max(...data.moderation.map((item) => item.value), 1);
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="COMMUNITY INSIGHTS"
        title="За цифрами — люди"
        description="Понимайте динамику сообщества и принимайте решения на основе данных."
        action={<Badge>Последние {data.activity.length} дней</Badge>}
      />
      <div className="metrics-grid analytics-metrics">
        <Metric
          label="Сообщения"
          value={formatNumber(data.summary.messages)}
          icon={<MessageSquare size={18} />}
          note="В выбранном периоде"
        />
        <Metric
          label="Нарушения"
          value={formatNumber(data.summary.violations)}
          icon={<ShieldCheck size={18} />}
          note="Зарегистрировано движком"
          color="amber"
        />
        <Metric
          label="Участники"
          value={
            data.growth.length ? formatNumber(data.growth.at(-1)!.members) : "—"
          }
          icon={<Users size={18} />}
          note="По последнему агрегату"
          color="cyan"
        />
      </div>
      <div className="analytics-grid">
        <section className="panel">
          <SectionHeading
            title="Динамика активности"
            meta="Сообщения и нарушения"
          />
          <ActivityChart data={data.activity} />
        </section>
        <section className="panel">
          <SectionHeading title="Рост сообщества" meta="Участники по дням" />
          <>
            {data.growth.length ? (
              <GrowthChart data={data.growth} />
            ) : (
              <Empty
                title="Снимки участников ещё не накоплены"
                description="Динамика появится после получения реальных снимков сообщества. Отсутствие данных не означает нулевой рост."
              />
            )}
          </>
        </section>
      </div>
      <section className="panel moderation-distribution">
        <SectionHeading
          title="Структура модерации"
          meta="Распределение зарегистрированных действий"
        >
          <BarChart3 size={20} className="muted" />
        </SectionHeading>
        {!data.moderation.length ? (
          <Empty
            title="Недостаточно данных"
            description="Распределение появится после первых действий модерации."
          />
        ) : (
          data.moderation.map((item, index) => (
            <div className="distribution-row" key={item.label}>
              <span>
                {{
                  warn: "Предупреждения",
                  mute: "Ограничения сообщений",
                  ban: "Блокировки",
                  kick: "Исключения",
                }[item.label] ?? item.label}
              </span>
              <div>
                <i
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    background: ["#8585ff", "#63d6e8", "#e9ad6b", "#ec8291"][
                      index % 4
                    ],
                  }}
                />
              </div>
              <strong>{formatNumber(item.value)}</strong>
            </div>
          ))
        )}
      </section>
      <div className="data-note">
        <BarChart3 size={15} />
        {data.notice ??
          "Агрегаты могут обновляться с задержкой. Демонстрационные данные помечены в верхней панели."}
      </div>
    </div>
  );
}
