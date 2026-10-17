import {
  ArrowUpRight,
  Ban,
  Clock3,
  MessageSquareWarning,
  ShieldCheck,
  VolumeX,
} from "lucide-react";
import type { Case } from "../types";
import { caseNames, formatDate, statusNames } from "../api";
import { Avatar, Badge, Empty } from "./ui";
import "../styles/moderation-shield.css";

export function CasesTable({
  items,
  onRevoke,
  pending,
}: {
  items: Case[];
  onRevoke?: (item: Case) => void;
  pending?: boolean;
}) {
  if (!items.length)
    return (
      <Empty
        title="История пока чиста"
        description="Здесь появятся решения модераторов и автоматических правил."
      />
    );
  return (
    <div className={`nox-cases ${onRevoke ? "nox-cases-editable" : ""}`}>
      <div className="nox-cases-head" aria-hidden="true">
        <span>Участник / причина</span>
        <span>Действие</span>
        <span>Создано</span>
        <span>Статус</span>
        {onRevoke && <span />}
      </div>
      {items.map((item) => {
        const Icon =
          item.kind === "ban"
            ? Ban
            : item.kind === "mute"
              ? VolumeX
              : ["unban", "unmute", "unwarn"].includes(item.kind)
                ? ShieldCheck
                : MessageSquareWarning;
        const canRevoke =
          ["active", "applied"].includes(item.status) &&
          ["ban", "mute", "warn"].includes(item.kind);
        return (
          <article
            className="case-row nox-case-row"
            key={item.id}
            aria-label={`${caseNames[item.kind] ?? item.kind}: ${item.target_name}`}
          >
            <div className="nox-case-person">
              <Avatar name={item.target_name} />
              <div>
                <strong>{item.target_name}</strong>
                <p title={item.reason}>{item.reason}</p>
                <span className="nox-case-actor">{item.actor_name}</span>
              </div>
            </div>
            <span className={`nox-case-kind nox-case-kind-${item.kind}`}>
              <Icon size={15} />
              {caseNames[item.kind] ?? item.kind}
            </span>
            <div className="nox-case-time">
              <time dateTime={item.created_at}>
                <Clock3 size={13} />
                {formatDate(item.created_at)}
              </time>
              {item.expires_at && (
                <small>До {formatDate(item.expires_at)}</small>
              )}
            </div>
            <div className="nox-case-status">
              <Badge
                tone={
                  item.status === "unknown"
                    ? "amber"
                    : item.status === "failed"
                      ? "red"
                      : ["active", "applied"].includes(item.status)
                        ? "green"
                        : "muted"
                }
              >
                {statusNames[item.status] ?? item.status}
              </Badge>
            </div>
            {onRevoke && (
              <div className="nox-case-control">
                {canRevoke ? (
                  <button
                    type="button"
                    className="nox-case-revoke"
                    title="Отменить наказание"
                    aria-label={`Отменить наказание ${item.target_name}`}
                    disabled={pending}
                    onClick={() => onRevoke(item)}
                  >
                    <ArrowUpRight size={18} />
                    <span>Отменить</span>
                  </button>
                ) : (
                  <span className="nox-case-unavailable" aria-hidden="true">
                    —
                  </span>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
