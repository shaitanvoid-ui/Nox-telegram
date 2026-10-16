import {
  Ban,
  Clock3,
  MessageSquareWarning,
  MoreHorizontal,
  VolumeX,
} from "lucide-react";
import type { Case } from "../types";
import { caseNames, formatDate, statusNames } from "../api";
import { Avatar, Badge, Empty } from "./ui";
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
        description="Здесь появятся действия модераторов и автоматических правил."
      />
    );
  return (
    <div className="case-table">
      <div className="case-table-head">
        <span>Участник / причина</span>
        <span>Действие</span>
        <span>Время</span>
        <span>Статус</span>
        {onRevoke && <span />}
      </div>
      {items.map((item) => {
        const Icon =
          item.kind === "ban"
            ? Ban
            : item.kind === "mute"
              ? VolumeX
              : MessageSquareWarning;
        return (
          <div className="case-row" key={item.id}>
            <div className="case-person">
              <Avatar name={item.target_name} />
              <div>
                <strong>{item.target_name}</strong>
                <span title={item.reason}>{item.reason}</span>
              </div>
            </div>
            <span className={`case-action ${item.kind}`}>
              <Icon size={14} />
              {caseNames[item.kind] ?? item.kind}
            </span>
            <span className="case-date">
              <Clock3 size={12} />
              {formatDate(item.created_at)}
            </span>
            <Badge
              tone={
                ["active", "applied"].includes(item.status)
                  ? "amber"
                  : item.status === "failed"
                    ? "red"
                    : "muted"
              }
            >
              {statusNames[item.status] ?? item.status}
            </Badge>
            {onRevoke && (
              <div className="case-control">
                {["active", "applied"].includes(item.status) &&
                item.kind !== "kick" ? (
                  <button
                    title="Отменить наказание"
                    aria-label={`Отменить наказание ${item.target_name}`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => onRevoke(item)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                ) : (
                  <span className="case-no-action">—</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
