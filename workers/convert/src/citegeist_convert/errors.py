"""Agent-ready errors, the Python mirror of AgentError in packages/schema/src/errors.ts."""

from __future__ import annotations

from typing import Any


class ConvertError(Exception):
    """An error that carries what failed, a safe fix, recovery semantics and a stable code."""

    def __init__(
        self,
        code: str,
        message: str,
        fix: str,
        recovery: str = "fix-and-retry",
        side_effects: str = "none",
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.fix = fix
        self.recovery = recovery
        self.side_effects = side_effects
        self.context = context or {}

    def detail(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "fix": self.fix,
            "recovery": self.recovery,
            "sideEffects": self.side_effects,
            "context": self.context,
        }
