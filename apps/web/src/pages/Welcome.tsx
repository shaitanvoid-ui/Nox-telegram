import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FlaskConical, ShieldCheck } from "lucide-react";
import { getHealth } from "../api";
import { useAuth } from "../auth";
import { Button, ErrorState, Logo } from "../components/ui";

export function Welcome() {
  const { loading, error, loginDemo } = useAuth();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: 1,
  });
  return (
    <div className="nox-welcome">
      <header className="nox-welcome-header">
        <Logo />
        <span>
          TELEGRAM COMMUNITY PLATFORM <i />
        </span>
      </header>
      <main className="nox-welcome-stage">
        <picture className="nox-welcome-art" aria-hidden="true">
          <source
            media="(max-width: 767px)"
            srcSet="/images/nox-sculpture-mobile.webp"
          />
          <img src="/images/nox-sculpture.webp" alt="" fetchPriority="high" />
        </picture>
        <div className="nox-welcome-copy">
          <div className="nox-welcome-eyebrow">
            <span />
            ASTRA / NEXT GENERATION
          </div>
          <h1>
            Сообщество.
            <br />
            <span>
              В новом
              <br className="nox-welcome-mobile-break" /> измерении.
            </span>
          </h1>
          <p>
            Модерация. Защита. Автоматизация.
            <br />
            Всё, что связывает ваше сообщество.
          </p>
          <div className="nox-welcome-entry">
            {health.isPending ? (
              <div className="nox-welcome-status" role="status">
                <span className="nox-live-dot" />
                Подключаемся к Astra…
              </div>
            ) : health.isError ? (
              <ErrorState
                error={health.error}
                retry={() => void health.refetch()}
              />
            ) : health.data.mode === "demo" ? (
              <>
                <Button
                  className="nox-welcome-cta"
                  loading={loading}
                  onClick={() => void loginDemo()}
                >
                  Открыть демо-пространство
                  <ArrowUpRight size={20} />
                </Button>
                <div className="nox-welcome-demo">
                  <FlaskConical size={14} />
                  <span>
                    Тестовые данные. Настоящий backend.
                    <br />
                    Telegram не подключён.
                  </span>
                </div>
              </>
            ) : (
              <div className="nox-telegram-entry">
                <ShieldCheck size={22} />
                <div>
                  <strong>
                    {loading
                      ? "Проверяем подпись Telegram…"
                      : "Войдите через Telegram"}
                  </strong>
                  <p>
                    Откройте Mini App из меню бота Astra. Если сессия истекла,
                    закройте приложение и откройте заново.
                  </p>
                </div>
              </div>
            )}
            {error && <ErrorState error={error} />}
          </div>
        </div>
        <span className="nox-welcome-art-caption" aria-hidden="true">
          A NEW DIMENSION
          <br />
          OF CONNECTION.
        </span>
      </main>
      <footer className="nox-welcome-footer">
        <span>01 / УПРАВЛЯЙТЕ</span>
        <span>02 / ЗАЩИЩАЙТЕ</span>
        <span>03 / ОБЪЕДИНЯЙТЕ</span>
        <span>BUILT FOR TELEGRAM ↗</span>
      </footer>
    </div>
  );
}
