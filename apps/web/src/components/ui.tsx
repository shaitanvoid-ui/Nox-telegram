import { cloneElement, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  Shield,
  X,
} from "lucide-react";
import { haptic } from "../telegram";
import { ApiError } from "../api";
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <path d="M5 22V6h4l10 10V6h4v16h-4L9 12v10Z" fill="currentColor" />
        </svg>
      </div>
      {!compact && (
        <>
          <span>
            nox<span className="brand-dot">.</span>
          </span>
          <span className="brand-os">COMMUNITY OS</span>
        </>
      )}
    </div>
  );
}
export function Button({
  children,
  variant = "primary",
  loading = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      onClick={(e) => {
        haptic();
        props.onClick?.(e);
      }}
      disabled={props.disabled || loading}
      className={`button button-${variant} ${className}`}
    >
      {loading ? <LoaderCircle className="spin" size={16} /> : null}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "green" | "violet" | "amber" | "red" | "muted" | "cyan";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>
          {title}
          <span className="title-dot">.</span>
        </h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
export function SectionHeading({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {meta && <p>{meta}</p>}
      </div>
      {children}
    </div>
  );
}
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Shield size={24} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading({
  label = "Загружаем пространство",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={26} className="spin" />
      <p>{label}…</p>
      <div className="skeleton-lines">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  const denied = error instanceof ApiError && [401, 403].includes(error.status);
  return (
    <div className="error-state" role="alert">
      {denied ? <LockKeyhole size={26} /> : <AlertCircle size={26} />}
      <h3>{denied ? "Доступ ограничен" : "Не удалось загрузить данные"}</h3>
      <p>{error.message}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Повторить запрос
        </Button>
      )}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "notice-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error ? <AlertCircle size={17} /> : <Check size={17} />}
      <span>{children}</span>
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input, button, select, textarea")
      ?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const targets = ref.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input, select, textarea, a[href]",
        );
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">NOX / WORKSPACE</div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть окно"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function ArrowLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function Avatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "normal" | "large";
}) {
  return (
    <span className={`avatar avatar-${size}`}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const describedBy =
    [children.props["aria-describedby"], hint ? hintId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={controlId}>
        {label}
      </label>
      {cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
      })}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function Metric({
  label,
  value,
  icon,
  note,
  color = "violet",
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  note: string;
  color?: string;
}) {
  return (
    <div className="metric panel">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${color}`}>{icon}</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">
        <span className={`tiny-dot ${color}`} />
        {note}
      </div>
    </div>
  );
}
export function InlineArrow() {
  return <ChevronRight size={16} />;
}
