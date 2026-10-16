export interface User {
  id: number;
  first_name: string;
}
export interface Session {
  access_token: string;
  user: User;
  mode: "demo" | "production";
}
export interface Chat {
  id: number;
  title: string;
  member_count: number;
  role: string;
}
export interface Member {
  id: number;
  first_name: string;
  username: string | null;
  role: string;
  joined_at: string;
}
export interface Case {
  id: string;
  kind: string;
  reason: string;
  target_name: string;
  target_user_id: number;
  actor_name: string;
  status: string;
  created_at: string;
  expires_at: string | null;
}
export interface Page<T> {
  items: T[];
  total: number;
}
export interface ActivityPoint {
  label: string;
  messages: number;
  violations: number;
}
export interface Dashboard {
  stats: {
    members: number;
    messages_today: number;
    actions_today: number;
    protection_score: number;
  };
  activity: ActivityPoint[];
  recent_cases: Case[];
  protection: { enabled: number; total: number };
  mode: string;
}
export interface ShieldModule {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  sensitivity: number;
  events: number;
}
export interface Shield {
  modules: ShieldModule[];
  emergency_enabled: boolean;
}
export type Trigger = "member_join" | "flood" | "warnings";
export type Action = "welcome" | "delete" | "mute";
export interface AutomationDraft {
  name: string;
  trigger: Trigger;
  conditions: { threshold?: number; duration_minutes?: number };
  action: Action;
  enabled: boolean;
  priority: number;
}
export interface Automation extends AutomationDraft {
  id: string;
  executions: number;
}
export interface Preview {
  matched: boolean;
  action: string;
  explanation: string;
  side_effects: boolean;
}
export interface Analytics {
  notice?: string;
  activity: ActivityPoint[];
  growth: { label: string; members: number }[];
  moderation: { label: string; value: number }[];
  summary: { messages: number; violations: number; retention: number | null };
}
export interface Settings {
  title: string;
  language: string;
  welcome_message: string;
  warn_limit: number;
  ai_enabled: boolean;
  privacy_retention_days: number;
}
export interface AuditEvent {
  id: string;
  action: string;
  actor_name: string;
  detail: string;
  created_at: string;
}
export interface Intelligence {
  enabled: boolean;
  provider: string;
  policy: string;
  items: {
    id: string;
    module: string;
    user_id: number;
    detail: string;
    created_at: string;
    source: "heuristic";
    requires_review: boolean;
  }[];
  notice: string;
}
export interface Appeal {
  id: string;
  case_id: string;
  user_name: string;
  reason: string;
  status: string;
  created_at: string;
}

export interface AutomationExecution {
  id: string;
  rule_name: string;
  rule_id: string;
  status: string;
  created_at: string;
}
