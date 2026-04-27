"""
Python Client Example for Aegis REST API

Demonstrates creating a session, sending a prompt, handling permission
prompts, polling for completion, and reading the transcript.

Usage:
    pip install requests
    python examples/standalone/python-client.py /path/to/project

Environment variables:
    AEGIS_BASE_URL   — Aegis server URL (default: http://127.0.0.1:9100)
    AEGIS_AUTH_TOKEN  — Bearer token for authentication (default: none)
"""

import json
import os
import sys
import time
from typing import Any

import requests

BASE_URL = os.environ.get("AEGIS_BASE_URL", "http://127.0.0.1:9100")
AUTH_TOKEN = os.environ.get("AEGIS_AUTH_TOKEN", "")
POLL_INTERVAL = 3  # seconds
MAX_WAIT = 600  # seconds (10 minutes)


def headers() -> dict[str, str]:
    """Build request headers with optional auth."""
    h = {"Content-Type": "application/json"}
    if AUTH_TOKEN:
        h["Authorization"] = f"Bearer {AUTH_TOKEN}"
    return h


def create_session(work_dir: str, name: str, prompt: str) -> str:
    """Create a new Aegis session and return its ID."""
    resp = requests.post(
        f"{BASE_URL}/v1/sessions",
        headers=headers(),
        json={"workDir": work_dir, "name": name, "prompt": prompt},
        timeout=30,
    )
    resp.raise_for_status()
    session_id = resp.json()["id"]
    print(f"✅ Created session: {name} ({session_id})")
    return session_id


def send_message(session_id: str, text: str) -> None:
    """Send a message to an existing session."""
    resp = requests.post(
        f"{BASE_URL}/v1/sessions/{session_id}/send",
        headers=headers(),
        json={"text": text},
        timeout=30,
    )
    resp.raise_for_status()
    print(f"📤 Sent message to {session_id[:8]}...")


def approve_session(session_id: str) -> None:
    """Auto-approve a pending permission prompt."""
    resp = requests.post(
        f"{BASE_URL}/v1/sessions/{session_id}/approve",
        headers=headers(),
        timeout=10,
    )
    resp.raise_for_status()


def read_session(session_id: str) -> dict[str, Any]:
    """Read the current state and transcript of a session."""
    resp = requests.get(
        f"{BASE_URL}/v1/sessions/{session_id}/read",
        headers=headers(),
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def poll_until_idle(session_id: str) -> list[dict[str, Any]]:
    """Poll a session until it reaches idle state. Returns all messages."""
    started = time.time()

    while time.time() - started < MAX_WAIT:
        time.sleep(POLL_INTERVAL)

        try:
            data = read_session(session_id)
        except requests.RequestException as e:
            print(f"⚠️  Read error: {e}, retrying...")
            continue

        status = data.get("status", "unknown")

        # Auto-approve permission prompts
        if status in ("permission_prompt", "bash_approval"):
            print(f"🔓 Approving permission prompt...")
            approve_session(session_id)
            continue

        if status == "idle":
            return data.get("messages", [])

        # Still working — show a spinner-like indicator
        elapsed = int(time.time() - started)
        print(f"⏳ Working... ({elapsed}s)")

    raise TimeoutError(f"Session {session_id[:8]}... timed out after {MAX_WAIT}s")


def extract_result(messages: list[dict[str, Any]]) -> str:
    """Extract the last assistant message from transcript."""
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and msg.get("text"):
            return msg["text"].strip()
    return "(no assistant response found)"


def kill_session(session_id: str) -> None:
    """Kill a session and clean up resources."""
    try:
        requests.delete(f"{BASE_URL}/v1/sessions/{session_id}", headers=headers(), timeout=10)
        print(f"🧹 Killed session {session_id[:8]}...")
    except requests.RequestException:
        pass


def main() -> None:
    work_dir = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    prompt = sys.argv[2] if len(sys.argv) > 2 else (
        "Analyze this project briefly: what language, framework, and build tool does it use?"
    )

    print(f"\n🚀 Aegis Python Client")
    print(f"   Server: {BASE_URL}")
    print(f"   Workdir: {work_dir}")
    print(f"   Prompt: {prompt}\n")

    # Step 1: Create session
    session_id = create_session(work_dir, "python-client", prompt)

    try:
        # Step 2: Poll until done
        print(f"\n⏳ Waiting for completion...\n")
        messages = poll_until_idle(session_id)

        # Step 3: Display result
        result = extract_result(messages)
        print("\n" + "=" * 60)
        print("RESULT")
        print("=" * 60)
        print(result)
        print("=" * 60 + "\n")

        # Step 4: Show full transcript (optional)
        if "--verbose" in sys.argv:
            print("Full transcript:")
            print("-" * 40)
            for msg in messages:
                role = msg.get("role", "?")
                text = msg.get("text", "")
                if text:
                    print(f"[{role}] {text[:200]}{'...' if len(text) > 200 else ''}")
            print("-" * 40 + "\n")

    finally:
        # Always cleanup
        kill_session(session_id)

    print("✨ Done!")


if __name__ == "__main__":
    main()
