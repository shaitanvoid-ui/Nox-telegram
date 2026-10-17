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
  BarChart3,
  ChevronDown,
  Ellipsis,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { api } from "./api";
import { useAuth } from "./auth";
import {
  Avatar,
  Button,
  Empty,
  ErrorState,
  Loading,
  Logo,
  Modal,
} from "./components/ui";
import { WorkspaceContext } from "./workspace";
import type { Chat } from "./types";
import { syncBackButton } from "./telegram";
import { Welcome } from "./pages/Welcome";
import { DashboardPage } from "./pages/Dashboard";
import { ModerationPage } from "./pages/Moderation";
import { ShieldPage } from "./pages/Shield";
import { StudioPage } from "./pages/Studio";
import { AnalyticsPage } from "./pages/Analytics";
import { SettingsPage } from "./pages/Settings";
import { IntelligencePage, AppealsPage } from "./pages/Reviews";

const navigation = [
  { path: "/", label: "Обзор", icon: LayoutDashboard },
  { path: "/moderation", label: "Модерация", icon: ShieldCheck },
  { path: "/shield", label: "Astra Shield", icon: Activity },
  { path: "/intelligence", label: "Intelligence", icon: Sparkles },
  { path: "/studio", label: "Studio", icon: Workflow },
  { path: "/analytics", label: "Аналитика", icon: BarChart3 },
  { path: "/appeals", label: "Апелляции", icon: MessageSquare },
  { path: "/settings", label: "Настройки", icon: Settings2 },
];
const roleNames: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  moderator: "Модератор",
  member: "Участник",
};

export default function App() {
  const { session } = useAuth();
  return session ? <WorkspaceShell /> : <Welcome />;
}

function WorkspaceShell() {
  const { session, logout } = useAuth();
  const [selectedChat, setSelectedChat] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const chats = useQuery({
    queryKey: ["chats"],
    queryFn: () => api<Chat[]>("/chats", session!.access_token),
  });
  const chat =
    chats.data?.find((item) => item.id === selectedChat) ?? chats.data?.[0];
  const active =
    navigation.find((item) => item.path === location.pathname) ?? navigation[0];
  useEffect(
    () =>
      syncBackButton(menuOpen || location.pathname !== "/", () => {
        if (menuOpen) setMenuOpen(false);
        else navigate("/");
      }),
    [location.pathname, menuOpen, navigate],
  );
  if (!session) return null;
  const role = chat ? (roleNames[chat.role] ?? chat.role) : "Astra";
  const links = navigation.map((item, index) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) =>
        `nox-nav-link${isActive ? " is-active" : ""}`
      }
      onClick={() => setMenuOpen(false)}
    >
      <item.icon size={19} strokeWidth={1.65} aria-hidden="true" />
      <span>{item.label}</span>
      <span className="nox-nav-index" aria-hidden="true">
        0{index + 1}
      </span>
    </NavLink>
  ));
  const chatPicker = (mobile = false) => (
    <div
      className={`nox-chat-picker${mobile ? " nox-chat-picker-mobile" : ""}`}
    >
      {!mobile && (
        <span className="nox-chat-avatar" aria-hidden="true">
          {chat?.title.slice(0, 1) ?? "N"}
        </span>
      )}
      <select
        aria-label={mobile ? "Текущий чат" : "Выбрать сообщество"}
        value={chat?.id ?? ""}
        disabled={!chats.data?.length}
        onChange={(event) => setSelectedChat(Number(event.target.value))}
      >
        {!chats.data?.length && <option value="">Ваши сообщества</option>}
        {chats.data?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </div>
  );
  return (
    <div className="nox-shell">
      <aside className="nox-sidebar">
        <NavLink
          to="/"
          className="nox-brand-link"
          aria-label="Astra — на главную"
        >
          <Logo />
        </NavLink>
        <div className="nox-workspace-caption">
          WORKSPACE <span>/ 01</span>
        </div>
        {chatPicker()}
        <nav className="nox-desktop-nav" aria-label="Основная навигация">
          {links}
        </nav>
        <div className="nox-sidebar-account">
          <div className="nox-account-identity">
            <Avatar name={session.user.first_name} />
            <span>
              <strong>{session.user.first_name}</strong>
              <small>
                {session.mode === "demo" ? "Демо-администратор" : role}
              </small>
            </span>
            <button
              type="button"
              className="nox-logout"
              aria-label="Завершить сессию"
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
          <div className="nox-build">
            <span>ASTRA / 0.1</span>
            <span>
              <i className={chats.isSuccess ? "is-online" : ""} />
              {chats.isSuccess ? "API подключён" : "Подключение"}
            </span>
          </div>
        </div>
      </aside>
      <div className="nox-workspace">
        <header className="nox-topbar">
          <div className="nox-desktop-heading">
            <span>ПРОСТРАНСТВО</span>
            <i />
            {active.label}
          </div>
          <NavLink
            to="/"
            className="nox-mobile-brand"
            aria-label="Astra — на главную"
          >
            <Logo compact />
          </NavLink>
          <div className="nox-mobile-chat">{chatPicker(true)}</div>
          <div className="nox-topbar-status">
            <span className="nox-live-dot" />
            {session.mode === "demo" ? "SANDBOX" : "TELEGRAM"}
            <span className="nox-topbar-role">{role}</span>
          </div>
          <button
            type="button"
            className="nox-mobile-menu-button"
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
        </header>
        {session.mode === "demo" && (
          <div className="nox-demo-disclosure">
            <FlaskConical size={13} aria-hidden="true" />
            <span>
              <strong>Демо.</strong> Тестовые данные · Telegram не подключён.
            </span>
          </div>
        )}
        <main className="nox-main">
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
              description="Добавьте бота в Telegram-чат, назначьте администратором и выполните /setup. Доступ появится после проверки прав."
            />
          ) : (
            <WorkspaceContext.Provider
              key={chat.id}
              value={{ chat, token: session.access_token, mode: session.mode }}
            >
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
          <footer className="nox-workspace-footer">
            <span>ASTRA COMMUNITY PLATFORM</span>
            <span>МЕНЬШЕ ШУМА. БОЛЬШЕ СВЯЗИ.</span>
          </footer>
        </main>
      </div>
      <nav className="nox-dock" aria-label="Мобильная навигация">
        {navigation
          .filter((item) =>
            ["/", "/moderation", "/shield", "/studio"].includes(item.path),
          )
          .map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) => (isActive ? "is-active" : "")}
            >
              <item.icon size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.path === "/shield" ? "Защита" : item.label}</span>
            </NavLink>
          ))}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
          className={
            menuOpen ||
            ["/intelligence", "/analytics", "/appeals", "/settings"].includes(
              location.pathname,
            )
              ? "is-active"
              : ""
          }
        >
          <Ellipsis size={21} aria-hidden="true" />
          <span>Ещё</span>
        </button>
      </nav>
      {menuOpen && (
        <Modal
          title="Навигация"
          description="Ваше пространство Astra"
          onClose={() => setMenuOpen(false)}
        >
          <nav className="nox-menu-nav" aria-label="Разделы пространства">
            {links}
          </nav>
          <div className="nox-menu-account">
            <Avatar name={session.user.first_name} />
            <span>
              {session.user.first_name}
              <small>
                {session.mode === "demo" ? "Демо-администратор" : role}
              </small>
            </span>
            <button
              type="button"
              className="nox-logout"
              aria-label="Завершить сессию"
              onClick={() => void logout()}
            >
              <LogOut size={19} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
