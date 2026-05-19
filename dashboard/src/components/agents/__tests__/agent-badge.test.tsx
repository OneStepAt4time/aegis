/**
 * AgentBadge + agent-registry tests.
 * Related: #3622
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentBadge } from "../AgentBadge";
import { getAgentMeta, getAgentFilterOptions, AGENT_REGISTRY } from "../agent-registry";

describe("agent-registry", () => {
  it("returns meta for known runners", () => {
    const cc = getAgentMeta("claude-code");
    expect(cc.label).toBe("Claude Code");
    expect(cc.color).toBe("purple");
  });

  it("returns default for undefined/null", () => {
    expect(getAgentMeta(undefined).label).toBe("Agent");
    expect(getAgentMeta(null).label).toBe("Agent");
  });

  it("returns gray badge with raw name for unknown runner", () => {
    const meta = getAgentMeta("future-agent-x");
    expect(meta.label).toBe("future-agent-x");
    expect(meta.color).toBe("gray");
  });

  it("filter options are sorted alphabetically", () => {
    const opts = getAgentFilterOptions();
    const labels = opts.map((o) => o.label);
    const sorted = [...labels].sort();
    expect(labels).toEqual(sorted);
  });

  it("all registry entries have required fields", () => {
    for (const [key, meta] of Object.entries(AGENT_REGISTRY)) {
      expect(meta.label, `${key} missing label`).toBeTruthy();
      expect(meta.color, `${key} missing color`).toBeTruthy();
    }
  });
});

describe("AgentBadge", () => {
  it("renders known agent label", () => {
    render(<AgentBadge runnerName="codex" />);
    expect(screen.getByText("Codex")).toBeDefined();
  });

  it("renders unknown runner as raw name", () => {
    render(<AgentBadge runnerName="custom-agent" />);
    expect(screen.getByText("custom-agent")).toBeDefined();
  });

  it("falls back to model heuristic when runnerName is absent", () => {
    render(<AgentBadge model="claude-sonnet-4-6" />);
    expect(screen.getByText("Claude Code")).toBeDefined();
  });

  it("renders generic Agent when no info available", () => {
    render(<AgentBadge />);
    expect(screen.getByText("Agent")).toBeDefined();
  });

  it("hides label in compact mode", () => {
    const { container } = render(<AgentBadge runnerName="codex" compact />);
    expect(container.textContent).toBe("");
  });

  it("has correct aria-label", () => {
    render(<AgentBadge runnerName="codex" />);
    expect(screen.getByLabelText("Agent: Codex")).toBeDefined();
  });
});
