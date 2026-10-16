import { useEffect, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Command,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { api, getHealth } from "./api";
import { useAuth } from "./auth";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Logo,
} from "./components/ui";
import { WorkspaceContext } from "./workspace";
import type { Chat } from "./types";
import { syncBackButton } from "./telegram";
import { DashboardPage } from "./pages/Dashboard";
import { ModerationPage } from "./pages/Moderation";
import { ShieldPage } from "./pages/Shield";
import { StudioPage } from "./pages/Studio";
import { AnalyticsPage } from "./pages/Analytics";
import { SettingsPage } from "./pages/Settings";
import { IntelligencePage, AppealsPage } from "./pages/Reviews";
const nav = [
  { path: "/", label: "Обзор", icon: LayoutDashboard },
  { path: "/moderation", label: "Модерация", icon: ShieldCheck },
  { path: "/shield", label: "NOX Shield", icon: Activity },
  { path: "/intelligence", label: "Intelligence", icon: Sparkles },
  { path: "/studio", label: "Studio", icon: Workflow },
  { path: "/analytics", label: "Аналитика", icon: BarChart3 },
  { path: "/appeals", label: "Апелляции", icon: MessageSquare },
  { path: "/settings", label: "Настройки", icon: Settings2 },
];
function Welcome() {
  const { loading, error, loginDemo } = useAuth();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: 1,
  });
  return (
    <div className="welcome">
      <div className="welcome-grid" />
      <div className="welcome-header">
        <Logo />
        <Badge tone="violet">FIRST RELEASE / 0.1</Badge>
      </div>
      <main className="welcome-content">
        <div className="welcome-orbit">
          <div className="orbit-ring one" />
          <div className="orbit-ring two" />
          <ShieldCheck size={48} strokeWidth={1.2} />
          <span className="orbit-dot" />
        </div>
        <div className="eyebrow">YOUR COMMUNITY. UNDER CONTROL.</div>
        <h1>
          Новое измерение
          <br />
          <span>вашего сообщества.</span>
        </h1>
        <p>
          Модерация, защита и автоматизация Telegram.
          <br />В одном спокойном, продуманном пространстве.
        </p>
        {health.isPending ? (
          <div className="welcome-hint" role="status">
            Подключаемся к NOX…
          </div>
        ) : health.isError ? (
          <div className="welcome-error">
            <ErrorState
              error={health.error}
              retry={() => void health.refetch()}
            />
          </div>
        ) : health.data.mode === "demo" ? (
          <>
            <Button loading={loading} onClick={() => void loginDemo()}>
              Открыть демо-пространство
              <ArrowRight size={18} />
            </Button>
            <div className="welcome-hint">
              <FlaskConical size={14} />
              Изолированные демонстрационные данные · настоящий API
            </div>
          </>
        ) : (
          <div className="telegram-entry">
            <ShieldCheck size={20} />
            <strong>
              {loading
                ? "Проверяем подпись Telegram…"
                : "Войдите через Telegram"}
            </strong>
            <span>
              Откройте Mini App из меню NOX-бота. Для обновления истёкшей сессии
              закройте приложение и откройте его заново.
            </span>
          </div>
        )}
        {error && (
          <div className="welcome-error">
            <ErrorState error={error} />
          </div>
        )}
        <div className="welcome-features">
          <span>
            <ShieldCheck size={17} />
            Многоуровневая защита
          </span>
          <span>
            <Workflow size={17} />
            Умные сценарии
          </span>
          <span>
            <BarChart3 size={17} />
            Понятная аналитика
          </span>
        </div>
      </main>
      <footer className="welcome-footer">
        <span>NOX COMMUNITY OS</span>
        <span>
          Для входа в рабочий чат откройте Mini App через бота в Telegram.
        </span>
      </footer>
    </div>
  );
}
export default function App() {
  const { session } = useAuth();
  return session ? <WorkspaceShell /> : <Welcome />;
}
function WorkspaceShell() {
  const { session, logout } = useAuth();
  const [selectedChat, setSelectedChat] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const chats = useQuery({
    queryKey: ["chats"],
    queryFn: () => api<Chat[]>("/chats", session!.access_token),
  });
  const chat =
    chats.data?.find((c) => c.id === selectedChat) ?? chats.data?.[0];
  useEffect(
    () => syncBackButton(location.pathname !== "/", () => navigate("/")),
    [location.pathname, navigate],
  );
  if (!session) return null;
  const active = nav.find((item) => item.path === location.pathname) ?? nav[0];
  const closeMenu = () => setMenu(false);
  const links = nav.map((item) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
      onClick={closeMenu}
    >
      <item.icon size={19} strokeWidth={1.7} />
      <span>{item.label}</span>
      {item.path === "/intelligence" && <span className="nav-beta">AI</span>}
    </NavLink>
  ));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <div className="sidebar-chat">
          <span className="chat-mark">{chat?.title.slice(0, 1) ?? "N"}</span>
          <div>
            <strong>{chat?.title ?? "Ваши сообщества"}</strong>
            <span>Telegram community</span>
          </div>
          <ChevronDown size={15} />
          <select
            aria-label="Выбрать сообщество"
            value={chat?.id ?? ""}
            onChange={(e) => setSelectedChat(Number(e.target.value))}
          >
            {chats.data?.map((c) => (
              <option value={c.id} key={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <nav className="desktop-nav" aria-label="Основная навигация">
          {links}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div>
              <Command size={20} />
              <span>
                Меньше рутины.
                <br />
                <strong>Больше сообщества.</strong>
              </span>
            </div>
            <button onClick={() => navigate("/studio")}>
              Создать автоматизацию
              <ArrowRight size={15} />
            </button>
          </div>
          <button className="profile" onClick={logout} title="Завершить сессию">
            <Avatar name={session.user.first_name} />
            <span>
              <strong>{session.user.first_name}</strong>
              <small>
                {session.mode === "demo"
                  ? "Демо-администратор"
                  : (chat?.role ?? "Участник")}
              </small>
            </span>
            <LogOut size={17} />
          </button>
          <div className="sidebar-version">
            <span>NOX v0.1.0</span>
            <span className="tiny-dot green" />
            {chats.isSuccess ? "API подключён" : "Подключение"}
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="desktop-only">Рабочее пространство</span>
            <span className="desktop-only separator">/</span>
            <active.icon size={16} />
            <span>{active.label}</span>
          </div>
          <div className="topbar-right">
            <div className="connection">
              <span className="tiny-dot green" />
              {session.mode === "demo" ? "Демо-режим" : "Telegram"}
            </div>
            <span className="topbar-line" />
            <Badge tone="muted">
              {chat?.role === "owner"
                ? "Владелец"
                : chat?.role === "admin"
                  ? "Администратор"
                  : (chat?.role ?? "NOX")}
            </Badge>
            <button
              className="icon-button mobile-only"
              aria-label="Открыть меню"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
          </div>
        </header>
        {session.mode === "demo" && (
          <div className="demo-banner">
            <FlaskConical size={14} />
            <span>
              Демонстрационное пространство. Все изменения сохраняются в
              тестовой базе; Telegram не подключён.
            </span>
            <span className="demo-label">SANDBOX</span>
          </div>
        )}
        <main className="main-content">
          {chats.isPending ? (
            <Loading />
          ) : chats.isError ? (
            <ErrorState
              error={chats.error}
              retry={() => void chats.refetch()}
            />
          ) : !chat ? (
            <Empty
              title="Пока нет доступных чатов"
              description="Добавьте бота в Telegram-чат и назначьте администратором. Доступ появится после синхронизации прав."
            />
          ) : (
            <WorkspaceContext.Provider
              value={{ chat, token: session.access_token, mode: session.mode }}
            >
              <div className="mobile-chat">
                <span className="chat-mark">{chat.title[0]}</span>
                <select
                  aria-label="Текущий чат"
                  value={chat.id}
                  onChange={(e) => setSelectedChat(Number(e.target.value))}
                >
                  {chats.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </div>
              <Routes>
                <Route index element={<DashboardPage />} />
                <Route path="moderation" element={<ModerationPage />} />
                <Route path="shield" element={<ShieldPage />} />
                <Route path="studio" element={<StudioPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="intelligence" element={<IntelligencePage />} />
                <Route path="appeals" element={<AppealsPage />} />
                <Route
                  path="*"
                  element={
                    <Empty
                      title="Страница не найдена"
                      description="Этот адрес не существует в вашем пространстве."
                      action={
                        <Button onClick={() => navigate("/")}>
                          На главную
                        </Button>
                      }
                    />
                  }
                />
              </Routes>
            </WorkspaceContext.Provider>
          )}
          <footer className="content-footer">
            <span>NOX · Создан для вашего сообщества</span>
            <span>
              <ShieldCheck size={12} />
              Приватность по умолчанию
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Мобильная навигация">
        {nav
          .filter((item) =>
            ["/", "/moderation", "/shield", "/studio"].includes(item.path),
          )
          .map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/"}>
              <item.icon size={21} />
              <span>{item.label === "NOX Shield" ? "Защита" : item.label}</span>
            </NavLink>
          ))}
        <button onClick={() => setMenu(true)} className={menu ? "active" : ""}>
          <Menu size={21} />
          <span>Ещё</span>
        </button>
      </nav>
      {menu && (
        <div className="mobile-menu-backdrop" onClick={closeMenu}>
          <div
            className="mobile-menu"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Навигация"
          >
            <div className="mobile-menu-header">
              <Logo />
              <button
                className="icon-button"
                onClick={closeMenu}
                aria-label="Закрыть меню"
              >
                <X size={22} />
              </button>
            </div>
            {links}
            <button className="nav-link" onClick={logout}>
              <LogOut size={19} />
              Завершить сессию
            </button>
            <p className="menu-hint">
              <CircleHelp size={15} />
              Права на действия проверяются сервером.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
