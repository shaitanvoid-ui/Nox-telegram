import { ApiError } from "../api";
import { DashboardView } from "../components/dashboard/DashboardView";
import type { Dashboard } from "../types";
import { useChatQuery, useWorkspace } from "../workspace";

export function DashboardPage() {
  const query = useChatQuery<Dashboard>("dashboard");
  const { chat } = useWorkspace();

  return (
    <DashboardView
      communityName={chat.title}
      status={query.status}
      data={query.data}
      errorCode={
        query.error instanceof ApiError ? query.error.status : undefined
      }
      onRetry={() => void query.refetch()}
    />
  );
}
