import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  LockKeyhole,
  RefreshCw,
  Shield,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { caseNames, formatDate, formatNumber, statusNames } from "../../api";
import type { Case, Dashboard } from "../../types";
import { ActivityChart } from "./ActivityChart";
import { ShieldRing } from "./ShieldRing";
import "./nox-dashboard.css";

export interface DashboardViewProps {
  communityName: string;
  status: "pending" | "error" | "success";
  errorCode?: number;
  data?: Dashboard;
  onRetry?: () => void;
}

function headline(enabled: number, total: number) {
  if (!total) return "Модули защиты не настроены";
  if (!enabled) return "Все модули защиты выключены";
  if (enabled === total) return "Включены все модули защиты";
  return `Включено ${enabled} из ${total} модулей защиты`;
}

const today = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});

export function DashboardView({
  communityName,
  status,
  errorCode,
  data,
  onRetry,
}: DashboardViewProps) {
  if (status === "pending") return <DashboardSkeleton />;
  if (status === "error" || !data) {
    const denied = errorCode === 401 || errorCode === 403;
    return (
      <div className="nox-dashboard">
        <section className="nox-dashboard-state" role="alert">
          <span className="nox-state-icon">
            {denied ? (
              <LockKeyhole size={25} aria-hidden="true" />
            ) : (
              <RefreshCw size={25} aria-hidden="true" />
            )}
          </span>
          <h1>
            {denied ? "Нет доступа к обзору" : "Не удалось загрузить обзор"}
          </h1>
          <p>
            {errorCode === 401
              ? "Сессия истекла. Откройте Mini App заново через Telegram."
              : denied
                ? "Попросите владельца сообщества проверить ваши права."
                : "Проверьте соединение и повторите запрос."}
          </p>
          {!denied && onRetry && (
            <button className="nox-button" onClick={onRetry}>
              <RefreshCw size={16} aria-hidden="true" />
              Повторить запрос
            </button>
          )}
        </section>
      </div>
    );
  }

  const { stats, protection, activity, recent_cases } = data;
  const total = Math.max(0, Math.floor(protection.total));
  const enabled = Math.min(Math.max(0, Math.floor(protection.enabled)), total);
  const enabledPercent = total ? Math.round((enabled / total) * 100) : null;

  return (
    <div className="nox-dashboard">
      <div className="nox-overview-heading">
        <p>
          <span className="nox-overview-marker" aria-hidden="true" />
          Обзор сообщества
          <span className="nox-overview-divider" aria-hidden="true">
            /
          </span>
          <span className="nox-community-name">{communityName}</span>
        </p>
        <time dateTime={new Date().toISOString().slice(0, 10)}>
          {today.format(new Date())}
        </time>
      </div>

      <section className="nox-hero" aria-labelledby="nox-dashboard-title">
        <figure className="nox-hero-ring">
          <ShieldRing enabled={enabled} total={total} />
          <figcaption>модулей включено</figcaption>
        </figure>
        <div className="nox-hero-copy">
          <span className="nox-eyebrow">
            NOX SHIELD <span aria-hidden="true">/</span> КОНТУР ЗАЩИТЫ
          </span>
          <h1 id="nox-dashboard-title">{headline(enabled, total)}</h1>
          <p>Управляйте модулями и правилами вашего сообщества.</p>
          <Link to="/shield" className="nox-button">
            Настроить Shield <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="nox-hero-index" aria-hidden="true">
          <span>01</span>
          <i />
          ОБЗОР
        </div>
      </section>

      <dl className="nox-metrics">
        <Metric
          index="01"
          label="Участники"
          value={formatNumber(stats.members)}
          note="В сообществе"
        />
        <Metric
          index="02"
          label="Сообщения сегодня"
          value={formatNumber(stats.messages_today)}
          note="За текущие сутки"
        />
        <Metric
          index="03"
          label="Действия модерации"
          value={formatNumber(stats.actions_today)}
          note="За текущие сутки"
        />
        <Metric
          index="04"
          label="Включено модулей"
          value={
            enabledPercent === null ? (
              "—"
            ) : (
              <>
                {enabledPercent}
                <span className="nox-metric-unit">%</span>
              </>
            )
          }
          note={`${enabled} из ${total} модулей Shield`}
        />
      </dl>

      <section
        className="nox-activity-panel"
        aria-labelledby="nox-activity-title"
      >
        <header className="nox-section-header">
          <div>
            <span className="nox-eyebrow">АКТИВНОСТЬ</span>
            <h2 id="nox-activity-title">Пульс сообщества</h2>
            <p>Сообщения и нарушения — на отдельных шкалах</p>
          </div>
          <span className="nox-period-label">
            {activity.length ? `${activity.length} дней` : "Нет данных"}
          </span>
        </header>
        <ActivityChart data={activity} />
      </section>

      <section className="nox-cases-section" aria-labelledby="nox-cases-title">
        <header className="nox-section-header nox-section-header--cases">
          <div>
            <span className="nox-eyebrow">МОДЕРАЦИЯ</span>
            <h2 id="nox-cases-title">Последние действия</h2>
          </div>
          <Link to="/moderation" className="nox-text-link">
            Вся история
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </header>
        {!recent_cases.length ? (
          <div className="nox-cases-empty">
            <Check size={22} aria-hidden="true" />
            <div>
              <h3>История пока чиста</h3>
              <p>Здесь появятся действия модераторов и правил.</p>
            </div>
          </div>
        ) : (
          <ul className="nox-cases-list">
            {recent_cases.slice(0, 5).map((item) => (
              <RecentCase key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      <nav className="nox-quick-links" aria-label="Быстрые действия">
        <QuickLink
          to="/moderation"
          icon={<Shield size={18} />}
          title="Модерация"
          note="Участники и решения"
        />
        <QuickLink
          to="/appeals"
          icon={<ArrowDownRight size={18} />}
          title="Апелляции"
          note="Обратная связь"
        />
        <QuickLink
          to="/shield"
          icon={<Shield size={18} />}
          title="Shield"
          note="Модули защиты"
        />
        <QuickLink
          to="/studio"
          icon={<Workflow size={18} />}
          title="Studio"
          note="Ваши сценарии"
        />
      </nav>
    </div>
  );
}

function Metric({
  index,
  label,
  value,
  note,
}: {
  index: string;
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="nox-metric">
      <dt>
        <span className="nox-metric-index" aria-hidden="true">
          {index}
        </span>
        {label}
      </dt>
      <dd>{value}</dd>
      <span className="nox-metric-note">{note}</span>
    </div>
  );
}

function RecentCase({ item }: { item: Case }) {
  const tone =
    item.status === "failed"
      ? "danger"
      : [
            "active",
            "applied",
            "pending",
            "processing",
            "unknown",
            "revoking",
          ].includes(item.status)
        ? "warn"
        : "muted";
  const initials =
    item.target_name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "N";
  return (
    <li className="nox-case">
      <span className="nox-case-avatar" aria-hidden="true">
        {initials}
      </span>
      <div className="nox-case-person">
        <strong>{item.target_name}</strong>
        <span title={item.reason}>{item.reason}</span>
      </div>
      <div className="nox-case-action">
        <span>{caseNames[item.kind] ?? item.kind}</span>
        <span className="nox-case-actor">{item.actor_name}</span>
      </div>
      <time className="nox-case-time" dateTime={item.created_at}>
        <Clock3 size={13} aria-hidden="true" />
        {formatDate(item.created_at)}
      </time>
      <span className="nox-case-status" data-tone={tone}>
        {statusNames[item.status] ?? item.status}
      </span>
    </li>
  );
}

function QuickLink({
  to,
  icon,
  title,
  note,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  note: string;
}) {
  return (
    <Link to={to} className="nox-quick-link">
      <span className="nox-quick-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <span>{note}</span>
      </span>
      <ChevronRight size={15} aria-hidden="true" />
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="nox-dashboard nox-dashboard-loading"
      role="status"
      aria-busy="true"
      aria-label="Загрузка обзора"
    >
      <span className="nox-screen-reader-only">Загрузка обзора сообщества</span>
      <div className="nox-skeleton nox-skeleton--hero" />
      <div className="nox-skeleton nox-skeleton--metrics" />
      <div className="nox-skeleton nox-skeleton--chart" />
    </div>
  );
}
