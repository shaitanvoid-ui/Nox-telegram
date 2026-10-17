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
  ScanLine,
  X,
} from "lucide-react";
import { ApiError } from "../api";
import { haptic } from "../telegram";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`brand${compact ? " brand-compact" : ""}`}
      aria-label="Astra"
    >
      <svg
        className="brand-mark"
        viewBox="0 0 36 36"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M18 1.5 21.3 14.7 34.5 18 21.3 21.3 18 34.5 14.7 21.3 1.5 18 14.7 14.7Z M18 15.2 15.2 18 18 20.8 20.8 18Z"
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </svg>
      {!compact && <span className="brand-wordmark">ASTRA</span>}
    </div>
  );
}
export function Button({
  children,
  variant = "primary",
  loading = false,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`button button-${variant} ${className}`.trim()}
      onClick={(event) => {
        haptic();
        props.onClick?.(event);
      }}
    >
      {loading && (
        <LoaderCircle className="spin" size={17} aria-hidden="true" />
      )}
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
    <header className="page-header">
      <div className="page-heading">
        <p className="eyebrow">
          <span aria-hidden="true" />
          {eyebrow}
        </p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </header>
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
      <div className="section-heading-copy">
        <h2>{title}</h2>
        {meta && <p>{meta}</p>}
      </div>
      {children && <div className="section-heading-actions">{children}</div>}
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
      onClick={() => {
        haptic();
        onChange(!checked);
      }}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
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
      <div className="state-orbit" aria-hidden="true">
        <ScanLine size={26} strokeWidth={1.25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}
export function Loading({
  label = "Загружаем пространство",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-orbit" aria-hidden="true">
        <LoaderCircle size={28} className="spin" strokeWidth={1.25} />
      </div>
      <p>{label}…</p>
      <div className="skeleton-lines" aria-hidden="true">
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
  const Icon = denied ? LockKeyhole : AlertCircle;
  return (
    <div className="error-state" role="alert">
      <div className="state-orbit" aria-hidden="true">
        <Icon size={26} strokeWidth={1.25} />
      </div>
      <h3>{denied ? "Доступ ограничен" : "Не удалось загрузить данные"}</h3>
      <p>{error.message}</p>
      {retry && (
        <div className="state-action">
          <Button variant="secondary" onClick={retry}>
            Повторить запрос <ArrowUpRight size={16} aria-hidden="true" />
          </Button>
        </div>
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
  const Icon = error ? AlertCircle : Check;
  return (
    <div
      className={`notice${error ? " notice-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <span className="notice-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <span>{children}</span>
    </div>
  );
}
const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const priorFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getTargets = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
          [],
      ).filter(
        (element) =>
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true" &&
          window.getComputedStyle(element).display !== "none",
      );
    const focusFirst = () => (getTargets()[0] ?? dialogRef.current)?.focus();
    focusFirst();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const targets = getTargets();
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    function containFocus(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        !dialogRef.current?.contains(event.target)
      )
        focusFirst();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("focusin", containFocus);
      if (priorFocus?.isConnected) priorFocus.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.currentTarget === event.target) closeRef.current();
      }}
    >
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">ASTRA / WORKSPACE</p>
            <h2 id={titleId}>{title}</h2>
            {description && (
              <p id={descriptionId} className="modal-description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="icon-button modal-close"
            aria-label="Закрыть окно"
            onClick={() => closeRef.current()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
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
    <button type="button" className="text-link" onClick={onClick}>
      <span>{children}</span>
      <ArrowUpRight size={17} aria-hidden="true" />
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
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : name.slice(0, 2);
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials.toUpperCase()}
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
    <article className="metric panel">
      <header className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${color}`} aria-hidden="true">
          {icon}
        </span>
      </header>
      <div className="metric-value">{value}</div>
      <p className="metric-note">
        <span className={`tiny-dot ${color}`} aria-hidden="true" />
        {note}
      </p>
    </article>
  );
}
export function InlineArrow() {
  return <ChevronRight size={17} aria-hidden="true" />;
}
