"""Aegis Python Client — sync HTTP client for the Aegis orchestration middleware."""

from __future__ import annotations

import json
from typing import Any, BinaryIO
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote

from .models import *  # noqa: F401,F403

__all__ = ["AegisClient"]


class AegisClientError(Exception):
    """Raised when an Aegis API call fails."""

    def __init__(self, status: int, message: str, body: Any = None):
        self.status = status
        self.message = message
        self.body = body
        super().__init__(f"HTTP {status}: {message}")


class AegisClient:
    """Synchronous HTTP client for the Aegis REST API.

    Example::

        from aegis_python_client import AegisClient

        client = AegisClient(base_url="http://localhost:9100", auth_token="my-token")
        sessions = client.list_sessions()
        print(sessions)
    """

    def __init__(
        self,
        auth_token: str | None = None,
        base_url: str = "http://localhost:9100",
        timeout: float = 30.0,
    ):
        """Initialize the client.

        Args:
            auth_token: Bearer token for authentication.
            base_url: Aegis server URL.
            timeout: Request timeout in seconds.
        """
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.timeout = timeout

    # ── Internal ───────────────────────────────────────────────────

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.auth_token:
            h["Authorization"] = f"Bearer {self.auth_token}"
        if extra:
            h.update(extra)
        return h

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        query: dict[str, Any] | None = None,
        raw_body: bytes | BinaryIO | None = None,
        content_type: str | None = None,
    ) -> Any:
        url = self._url(path)
        if query:
            filtered = {k: v for k, v in query.items() if v is not None}
            if filtered:
                url += "?" + urlencode(filtered, doseq=True)

        data: bytes | BinaryIO | None = None
        headers = self._headers()
        if raw_body is not None:
            data = raw_body
            if content_type:
                headers["Content-Type"] = content_type
        elif body is not None:
            data = json.dumps(body).encode()

        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                ct = resp.headers.get("Content-Type", "")
                if "application/json" in ct:
                    return json.loads(resp.read().decode())
                return resp.read()
        except HTTPError as e:
            body_text = e.read().decode(errors="replace")
            try:
                parsed = json.loads(body_text)
                raise AegisClientError(e.code, parsed.get("error", body_text), parsed)
            except (json.JSONDecodeError, AegisClientError):
                raise AegisClientError(e.code, body_text)
        except URLError as e:
            raise AegisClientError(0, str(e.reason))

    def _get(self, path: str, **kwargs: Any) -> Any:
        return self._request("GET", path, **kwargs)

    def _post(self, path: str, **kwargs: Any) -> Any:
        return self._request("POST", path, **kwargs)

    def _delete(self, path: str, **kwargs: Any) -> Any:
        return self._request("DELETE", path, **kwargs)

    def _put(self, path: str, **kwargs: Any) -> Any:
        return self._request("PUT", path, **kwargs)

    # ── Health ─────────────────────────────────────────────────────

    def get_health(self) -> dict[str, Any]:
        """Get server health and version info."""
        return self._get("/v1/health")

    def get_swarm(self) -> dict[str, Any]:
        """Get swarm status."""
        return self._get("/v1/swarm")

    def get_diagnostics(self) -> dict[str, Any]:
        """Get server diagnostics."""
        return self._get("/v1/diagnostics")

    # ── Auth ───────────────────────────────────────────────────────

    def verify_token(self, token: str) -> dict[str, Any]:
        """Verify an API key token."""
        return self._post("/v1/auth/verify", body={"token": token})

    def list_api_keys(self) -> list[dict[str, Any]]:
        """List all API keys."""
        return self._get("/v1/auth/keys")

    def create_api_key(self, name: str, role: str = "viewer") -> dict[str, Any]:
        """Create a new API key."""
        return self._post("/v1/auth/keys", body={"name": name, "role": role})

    def delete_api_key(self, key_id: str) -> None:
        """Delete an API key."""
        self._delete(f"/v1/auth/keys/{quote(key_id, safe='')}")

    # ── Sessions ───────────────────────────────────────────────────

    def list_sessions(
        self,
        *,
        status: str | None = None,
        work_dir: str | None = None,
        page: int | None = None,
        page_size: int | None = None,
    ) -> dict[str, Any]:
        """List sessions with optional filters."""
        return self._get("/v1/sessions", query={
            "status": status,
            "workDir": work_dir,
            "page": page,
            "pageSize": page_size,
        })

    def get_session(self, session_id: str) -> dict[str, Any]:
        """Get a single session's info."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}")

    def create_session(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new Claude Code session.

        Args:
            work_dir: Working directory for the session.
            name: Optional session name.
            prompt: Optional initial prompt.
            model: Optional model override.
            system_prompt: Optional system prompt.
        """
        return self._post("/v1/sessions", body=kwargs)

    def kill_session(self, session_id: str) -> None:
        """Kill (terminate) a session."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/kill")

    def send_message(self, session_id: str, text: str) -> None:
        """Send a text message to a session."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/send", body={"text": text})

    def read_messages(
        self,
        session_id: str,
        *,
        page: int | None = None,
        page_size: int | None = None,
    ) -> dict[str, Any]:
        """Read the message transcript for a session."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/read", query={
            "page": page,
            "pageSize": page_size,
        })

    def get_session_health(self, session_id: str) -> dict[str, Any]:
        """Get session health and liveness data."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/health")

    def approve_permission(self, session_id: str) -> None:
        """Approve a pending permission prompt."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/approve")

    def reject_permission(self, session_id: str) -> None:
        """Reject a pending permission prompt."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/reject")

    def interrupt_session(self, session_id: str) -> None:
        """Interrupt the running session."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/interrupt")

    def escape_session(self, session_id: str) -> None:
        """Escape from ask_question mode."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/escape")

    def send_bash(self, session_id: str, command: str) -> None:
        """Execute a bash command in the session."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/bash", body={"command": command})

    def send_command(self, session_id: str, command: str) -> None:
        """Send a Claude Code slash command."""
        self._post(f"/v1/sessions/{quote(session_id, safe='')}/command", body={"command": command})

    def capture_pane(self, session_id: str) -> dict[str, Any]:
        """Capture the current terminal pane content."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/pane")

    def get_session_metrics(self, session_id: str) -> dict[str, Any]:
        """Get session metrics."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/metrics")

    def get_session_summary(self, session_id: str) -> dict[str, Any]:
        """Get a session summary."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/summary")

    def get_session_latency(self, session_id: str) -> dict[str, Any]:
        """Get latency metrics for a session."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/latency")

    def get_session_screenshot(self, session_id: str) -> dict[str, Any]:
        """Get a screenshot of the session terminal."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/screenshot")

    def get_session_permissions(self, session_id: str) -> dict[str, Any]:
        """Get the permission profile for a session."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/permissions")

    def update_permission_profile(self, session_id: str, **kwargs: Any) -> dict[str, Any]:
        """Update the permission profile for a session."""
        return self._put(f"/v1/sessions/{quote(session_id, safe='')}/permission-profile", body=kwargs)

    def fork_session(self, session_id: str, **kwargs: Any) -> dict[str, Any]:
        """Fork a session."""
        return self._post(f"/v1/sessions/{quote(session_id, safe='')}/fork", body=kwargs)

    def get_session_children(self, session_id: str) -> dict[str, Any]:
        """Get child sessions."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/children")

    def spawn_subagent(self, session_id: str, **kwargs: Any) -> dict[str, Any]:
        """Spawn a sub-agent session."""
        return self._post(f"/v1/sessions/{quote(session_id, safe='')}/spawn", body=kwargs)

    def get_session_memories(self, session_id: str) -> dict[str, Any]:
        """Get session memories."""
        return self._get(f"/v1/sessions/{quote(session_id, safe='')}/memories")

    def batch_create_sessions(self, sessions: list[dict[str, Any]]) -> dict[str, Any]:
        """Bulk-create multiple sessions."""
        return self._post("/v1/sessions/batch", body={"sessions": sessions})

    def get_session_stats(self) -> dict[str, Any]:
        """Get session statistics."""
        return self._get("/v1/sessions/stats")

    # ── Pipelines ──────────────────────────────────────────────────

    def list_pipelines(self) -> dict[str, Any]:
        """List all pipelines."""
        return self._get("/v1/pipelines")

    def create_pipeline(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new pipeline."""
        return self._post("/v1/pipelines", body=kwargs)

    def get_pipeline(self, pipeline_id: str) -> dict[str, Any]:
        """Get a pipeline's status."""
        return self._get(f"/v1/pipelines/{quote(pipeline_id, safe='')}")

    # ── Templates ──────────────────────────────────────────────────

    def list_templates(self) -> dict[str, Any]:
        """List all session templates."""
        return self._get("/v1/templates")

    def create_template(self, **kwargs: Any) -> dict[str, Any]:
        """Create a session template."""
        return self._post("/v1/templates", body=kwargs)

    def get_template(self, template_id: str) -> dict[str, Any]:
        """Get a session template."""
        return self._get(f"/v1/templates/{quote(template_id, safe='')}")

    def delete_template(self, template_id: str) -> None:
        """Delete a session template."""
        self._delete(f"/v1/templates/{quote(template_id, safe='')}")

    # ── Memory ─────────────────────────────────────────────────────

    def get_memory(self, key: str) -> dict[str, Any]:
        """Get a value from memory."""
        return self._get(f"/v1/memory/{quote(key, safe='')}")

    def set_memory(self, key: str, value: str, *, ttl_seconds: int | None = None) -> dict[str, Any]:
        """Store a value in memory."""
        body: dict[str, Any] = {"key": key, "value": value}
        if ttl_seconds is not None:
            body["ttlSeconds"] = ttl_seconds
        return self._post("/v1/memory", body=body)

    def delete_memory(self, key: str) -> None:
        """Delete a value from memory."""
        self._delete(f"/v1/memory/{quote(key, safe='')}")

    # ── State ──────────────────────────────────────────────────────

    def get_state(self, key: str) -> dict[str, Any]:
        """Get a state value."""
        return self._get(f"/v1/memories/{quote(key, safe='')}")

    def set_state(self, key: str, value: Any) -> dict[str, Any]:
        """Set a state value."""
        return self._post("/v1/memories", body={"key": key, "value": value})

    def delete_state(self, key: str) -> None:
        """Delete a state value."""
        self._delete(f"/v1/memories/{quote(key, safe='')}")

    # ── Monitoring ─────────────────────────────────────────────────

    def get_metrics(self) -> dict[str, Any]:
        """Get global Prometheus metrics."""
        return self._get("/v1/metrics")

    # ── Hooks ──────────────────────────────────────────────────────

    def invoke_hook(self, event_name: str, payload: Any) -> dict[str, Any]:
        """Invoke a webhook hook."""
        return self._post(f"/v1/hooks/{quote(event_name, safe='')}", body=payload)

    # ── Webhooks ───────────────────────────────────────────────────

    def get_dead_letter_queue(self) -> dict[str, Any]:
        """Get the dead letter queue entries."""
        return self._get("/v1/webhooks/dead-letter")

    # ── Tools ──────────────────────────────────────────────────────

    def list_tools(self) -> dict[str, Any]:
        """List available MCP tools."""
        return self._get("/v1/tools")
