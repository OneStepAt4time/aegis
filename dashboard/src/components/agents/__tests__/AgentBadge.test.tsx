import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentBadge } from "../AgentBadge";

vi.mock("../agent-registry", () => ({
  getAgentMeta: (runnerName: string | undefined) => {
    const meta: Record<string, { label: string; color: string }> = {
      "claude-code": { label: "Claude Code", color: "purple" },
      codex: { label: "Codex", color: "green" },
      "gemini-cli": { label: "Gemini CLI", color: "blue" },
      qwen: { label: "Qwen", color: "amber" },
      copilot: { label: "Copilot", color: "cyan" },
    };
    return meta[runnerName ?? ""] ?? { label: runnerName ?? "Unknown", color: "gray" };
  },
}));

describe("AgentBadge", () => {
  it("renders with runnerName", () => {
    render(<AgentBadge runnerName="claude-code" />);
    expect(screen.getByText("Claude Code")).toBeDefined();
  });

  it("renders with aria-label", () => {
    render(<AgentBadge runnerName="claude-code" />);
    expect(screen.getByText("Claude Code").getAttribute("aria-label")).toBe("Agent: Claude Code");
  });

  it("renders compact mode without label", () => {
    const { container } = render(<AgentBadge runnerName="claude-code" compact />);
    expect(container.textContent).toBe("");
  });

  it("infers runner from model when runnerName absent", () => {
    render(<AgentBadge model="claude-opus-4.7" />);
    expect(screen.getByText("Claude Code")).toBeDefined();
  });

  it("renders unknown for unrecognized model", () => {
    render(<AgentBadge model="llama-3.1-70b" />);
    expect(screen.getByText("Unknown")).toBeDefined();
  });

  it("renders unknown when no props provided", () => {
    render(<AgentBadge />);
    expect(screen.getByText("Unknown")).toBeDefined();
  });

  it("renders Codex for GPT models", () => {
    render(<AgentBadge model="gpt-4o" />);
    expect(screen.getByText("Codex")).toBeDefined();
  });

  it("renders Gemini CLI for gemini models", () => {
    render(<AgentBadge model="gemini-2.5-pro" />);
    expect(screen.getByText("Gemini CLI")).toBeDefined();
  });

  it("applies custom className", () => {
    render(<AgentBadge runnerName="claude-code" className="custom-class" />);
    const badge = screen.getByText("Claude Code");
    expect(badge.classList.contains("custom-class")).toBe(true);
  });
});
