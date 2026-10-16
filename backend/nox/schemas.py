from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Kind = Literal["warn", "unwarn", "ban", "unban", "mute", "unmute", "kick"]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TelegramAuth(InputModel):
    init_data: str = Field(min_length=1, max_length=16384)


class UserOut(BaseModel):
    id: int
    first_name: str


class SessionOut(BaseModel):
    access_token: str
    user: UserOut
    mode: str


class ChatOut(BaseModel):
    id: int
    title: str
    member_count: int
    role: str


class CaseCreate(InputModel):
    target_user_id: int = Field(gt=0)
    kind: Kind
    reason: str = Field(min_length=1, max_length=1000)
    duration_minutes: int | None = Field(default=None, ge=1, le=525600)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def duration_kind(self) -> "CaseCreate":
        if self.duration_minutes is not None and self.kind not in {"ban", "mute"}:
            raise ValueError("Срок поддерживается только для ban/mute")
        if not self.reason.strip():
            raise ValueError("Укажите причину")
        return self


class CaseOut(BaseModel):
    id: str
    kind: str
    reason: str
    target_name: str
    target_user_id: int
    actor_name: str
    status: str
    created_at: datetime
    expires_at: datetime | None
    error_code: str | None = None


class CasePage(BaseModel):
    items: list[CaseOut]
    total: int


class ShieldModuleOut(BaseModel):
    key: str
    name: str
    description: str
    enabled: bool
    sensitivity: int
    events: int


class ShieldOut(BaseModel):
    modules: list[ShieldModuleOut]
    emergency_enabled: bool


class ModulePatch(InputModel):
    key: str = Field(max_length=32)
    enabled: bool | None = None
    sensitivity: int | None = Field(default=None, ge=1, le=100)


class ShieldPatch(InputModel):
    modules: list[ModulePatch] = Field(min_length=1, max_length=10)


class RuleConditions(InputModel):
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    threshold: int | None = Field(default=None, ge=1, le=1000)


class RuleCreate(InputModel):
    name: str = Field(min_length=1, max_length=120)
    trigger: Literal["member_join", "flood", "warnings"]
    conditions: RuleConditions = Field(default_factory=RuleConditions)
    action: Literal["welcome", "delete", "mute"]
    enabled: bool = True
    priority: int = Field(default=50, ge=0, le=100)

    @model_validator(mode="after")
    def valid_pair(self) -> "RuleCreate":
        allowed = {"member_join": {"welcome"}, "flood": {"delete", "mute"}, "warnings": {"mute"}}
        if self.action not in allowed[self.trigger]:
            raise ValueError("Действие не поддерживается для этого события")
        return self


class RulePatch(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=100)


class RulePreview(InputModel):
    trigger: Literal["member_join", "flood", "warnings"]
    conditions: RuleConditions = Field(default_factory=RuleConditions)
    action: Literal["welcome", "delete", "mute"]
    sample_count: int = Field(default=5, ge=0, le=10000)


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    trigger: str
    conditions: dict[str, Any]
    action: str
    enabled: bool
    priority: int
    executions: int


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: str
    language: str
    welcome_message: str
    warn_limit: int
    ai_enabled: bool
    privacy_retention_days: int


class SettingsPatch(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    language: Literal["ru", "en"] | None = None
    welcome_message: str | None = Field(default=None, max_length=2000)
    warn_limit: int | None = Field(default=None, ge=1, le=20)
    ai_enabled: bool | None = None
    privacy_retention_days: int | None = Field(default=None, ge=1, le=365)


class AppealCreate(InputModel):
    case_id: str = Field(min_length=36, max_length=36)
    reason: str = Field(min_length=5, max_length=2000)


class AppealResolve(InputModel):
    status: Literal["accepted", "rejected"]
