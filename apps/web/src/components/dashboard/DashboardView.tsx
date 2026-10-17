import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { caseNames, formatDate, formatNumber, statusNames } from "../../api";
import type { Case, Dashboard } from "../../types";
import { ActivityChart } from "./ActivityChart";
import "./dashboard.css";
import "./dashboard-responsive.css";

export interface DashboardViewProps {
  communityName: string;
  status: "pending" | "error" | "success";
  errorCode?: number;
  data?: Dashboard;
  onRetry?: () => void;
}

const day = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});

function count(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

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
      <div className="nd-dashboard">
        <section className="nd-state" role="alert">
          <span className="nd-state-icon" aria-hidden="true">
            {denied ? <LockKeyhole size={26} /> : <RefreshCw size={26} />}
          </span>
          <p className="nd-kicker">ASTRA / ОБЗОР</p>
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
            <button className="nd-primary" onClick={onRetry}>
              Повторить запрос <RefreshCw size={16} aria-hidden="true" />
            </button>
          )}
        </section>
      </div>
    );
  }

  const { stats, protection, activity, recent_cases } = data;
  const total = count(protection.total);
  const enabled = Math.min(count(protection.enabled), total);

  return (
    <div className="nd-dashboard">
      <div className="nd-page-caption">
        <p>
          <span aria-hidden="true" />
          ПАНЕЛЬ СООБЩЕСТВА
        </p>
        <time dateTime={new Date().toISOString().slice(0, 10)}>
          {day.format(new Date())}
        </time>
      </div>

      <section className="nd-hero" aria-labelledby="nd-title">
        <picture className="nd-hero-art" aria-hidden="true">
          <source
            media="(max-width: 600px)"
            srcSet="/images/nox-sculpture-mobile.webp"
          />
          <img
            src="/images/nox-sculpture.webp"
            alt=""
            width="1536"
            height="1024"
            fetchPriority="high"
          />
        </picture>
        <div className="nd-hero-wash" aria-hidden="true" />
        <div className="nd-hero-copy">
          <span className="nd-kicker">ASTRA / COMMUNITY CONTROL</span>
          <h1 id="nd-title">
            Ваше <br />
            сообщество.
          </h1>
          <p className="nd-community">{communityName}</p>
          <Link to="/moderation" className="nd-primary">
            Управлять{" "}
            <span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </span>
          </Link>
        </div>
        <span className="nd-hero-coordinate" aria-hidden="true">
          CONNECTED BY ASTRA
        </span>
      </section>

      <dl className="nd-vitals" aria-label="Статистика сообщества">
        <div className="nd-vital">
          <dt>
            Сообщения сегодня <span aria-hidden="true">01</span>
          </dt>
          <dd>{formatNumber(stats.messages_today)}</dd>
          <span className="nd-vital-note">
            <span aria-hidden="true" />
            За текущие сутки
          </span>
        </div>
        <div className="nd-vital">
          <dt>
            Участники <span aria-hidden="true">02</span>
          </dt>
          <dd>{formatNumber(stats.members)}</dd>
          <span className="nd-vital-note">В сообществе</span>
        </div>
      </dl>

      <Link to="/shield" className="nd-shield-strip">
        <span className="nd-shield-emblem" aria-hidden="true">
          <ShieldCheck size={22} strokeWidth={1.5} />
        </span>
        <span className="nd-shield-copy">
          <strong>Astra Shield</strong>
          <span>
            {total
              ? `${enabled} из ${total} модулей включено`
              : "Модули ещё не настроены"}
          </span>
        </span>
        <span className="nd-shield-meter" aria-hidden="true">
          {Array.from({ length: Math.min(total, 20) }, (_, index) => (
            <i
              key={index}
              data-on={
                index < Math.round((enabled / total) * Math.min(total, 20))
              }
            />
          ))}
        </span>
        <span className="nd-shield-open">
          Настроить <ArrowUpRight size={17} aria-hidden="true" />
        </span>
        <ChevronRight
          className="nd-shield-chevron"
          size={18}
          aria-hidden="true"
        />
      </Link>

      <div className="nd-work-grid">
        <section className="nd-activity" aria-labelledby="nd-activity-title">
          <header className="nd-section-heading">
            <div>
              <p className="nd-kicker">01 / АНАЛИТИКА</p>
              <h2 id="nd-activity-title">Ритм сообщества</h2>
            </div>
            <Link
              to="/analytics"
              className="nd-section-link"
              aria-label="Открыть аналитику"
            >
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
          </header>
          <ActivityChart data={activity} />
        </section>

        <section className="nd-events" aria-labelledby="nd-events-title">
          <header className="nd-section-heading">
            <div>
              <p className="nd-kicker">02 / МОДЕРАЦИЯ</p>
              <h2 id="nd-events-title">В фокусе</h2>
            </div>
            <Link
              to="/moderation"
              className="nd-section-link"
              aria-label="Открыть историю модерации"
            >
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
          </header>
          <div className="nd-event-summary">
            <span>Действия сегодня</span>
            <strong>{formatNumber(stats.actions_today)}</strong>
          </div>
          {!recent_cases.length ? (
            <div className="nd-events-empty">
              <Check size={24} aria-hidden="true" />
              <h3>История пока чиста</h3>
              <p>Здесь появятся действия модераторов и правил.</p>
            </div>
          ) : (
            <ol className="nd-event-list">
              {recent_cases.slice(0, 4).map((item) => (
                <RecentCase key={item.id} item={item} />
              ))}
            </ol>
          )}
          <Link to="/moderation" className="nd-history-link">
            Вся история <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </div>

      <nav className="nd-shortcuts" aria-label="Быстрые действия">
        <QuickLink
          to="/moderation"
          icon={<Users size={21} />}
          title="Участники"
          note="Люди и роли"
          index="01"
        />
        <QuickLink
          to="/appeals"
          icon={<ArrowDownLeft size={21} />}
          title="Апелляции"
          note="Обратная связь"
          index="02"
        />
        <QuickLink
          to="/studio"
          icon={<Workflow size={21} />}
          title="Сценарии"
          note="Автоматизация"
          index="03"
        />
      </nav>
      <div className="nd-bottom-mark" aria-hidden="true">
        <span>YOUR COMMUNITY. YOUR CONTROL.</span>
        <span>ASTRA</span>
      </div>
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
        ? "amber"
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
    <li className="nd-event">
      <span className="nd-event-avatar" aria-hidden="true">
        {initials}
      </span>
      <div className="nd-event-body">
        <div className="nd-event-person">
          <strong>{item.target_name}</strong>
          <span data-tone={tone}>
            {statusNames[item.status] ?? item.status}
          </span>
        </div>
        <p>
          <span>{caseNames[item.kind] ?? item.kind}</span>
          <span aria-hidden="true">·</span>
          {item.reason}
        </p>
        <div className="nd-event-meta">
          <span>{item.actor_name}</span>
          <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
        </div>
      </div>
    </li>
  );
}

function QuickLink({
  to,
  icon,
  title,
  note,
  index,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  note: string;
  index: string;
}) {
  return (
    <Link to={to} className="nd-shortcut">
      <span className="nd-shortcut-top">
        <span aria-hidden="true">{icon}</span>
        <span>{index}</span>
      </span>
      <span className="nd-shortcut-bottom">
        <span>
          <strong>{title}</strong>
          <span>{note}</span>
        </span>
        <ArrowUpRight size={20} aria-hidden="true" />
      </span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="nd-dashboard nd-loading"
      role="status"
      aria-busy="true"
      aria-label="Загрузка обзора"
    >
      <span className="nd-sr-only">Загрузка обзора сообщества</span>
      <div className="nd-skeleton nd-skeleton-hero" />
      <div className="nd-skeleton nd-skeleton-vitals" />
      <div className="nd-skeleton nd-skeleton-chart" />
    </div>
  );
}
