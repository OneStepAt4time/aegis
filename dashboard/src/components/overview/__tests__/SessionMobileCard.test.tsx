import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionMobileCard } from "../SessionMobileCard";
import { MemoryRouter } from "react-router-dom";
import type { SessionInfo } from "../../../types";

vi.mock("../StatusDot", () => ({
  default: ({ status }: { status: string }) => (
    <span data-testid="status-dot" data-status={status} />
  ),
}));

const baseSession: SessionInfo = {
  id: "sess-tes2345678",
  status: "working",
  workDir: "~/project",
  createdAt: new Date("2026-05-27T08:00:00Z"),
  lastActivity: new Date("2026-05-27T08:30:00Z"),
  displayName: null,
  latestActivityText: "Implementing feature X",
  permissionMode: "default",
  model: "claude-opus-4.7",
} as unknown as SessionInfo;

const baseRowProps = {
  session: baseSession,
  isAlive: true,
  health: null,
  selected: false,
  currentAction: null,
  estimatedCostUsd: 0.05,
  isFocused: false,
  onToggleSelect: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onInterrupt: vi.fn(),
  onKill: vi.fn(),
};

function renderCard(overrides = {}) {
  return render(
    <MemoryRouter>
      <SessionMobileCard {...baseRowProps} {...overrides} />
    </MemoryRouter>,
  );
}

describe("SessionMobileCard", () => {
  it("renders session card", () => {
    renderCard();
    expect(screen.getByText("sess-tes")).toBeDefined();
  });

  it("renders work directory", () => {
    renderCard();
    expect(screen.getByText("~/project")).toBeDefined();
  });

  it("renders status dot", () => {
    renderCard();
    expect(screen.getByTestId("status-dot")).toBeDefined();
  });

  it("renders latest activity text", () => {
    renderCard();
    expect(screen.getByText("Implementing feature X")).toBeDefined();
  });

  it("renders cost estimate", () => {
    renderCard({ estimatedCostUsd: 1.23 });
    expect(screen.getByText("$1.23")).toBeDefined();
  });

  it("renders permission mode badge", () => {
    renderCard();
    expect(screen.getByText("default")).toBeDefined();
  });

  it("renders custom permission mode", () => {
    renderCard({ session: { ...baseSession, permissionMode: "strict" } as SessionInfo });
    expect(screen.getByText("strict")).toBeDefined();
  });

  it("renders session link", () => {
    renderCard();
    const link = screen.getByText("sess-tes").closest("a");
    expect(link?.getAttribute("href")).toContain("/sessions/sess-tes2345678");
  });

  it("renders interrupt button", () => {
    renderCard();
    expect(screen.getByRole("button", { name: /Interrupt/i })).toBeDefined();
  });

  it("renders kill button", () => {
    renderCard();
    expect(screen.getByRole("button", { name: /Kill/i })).toBeDefined();
  });

  it("calls onInterrupt when button clicked", () => {
    const onInterrupt = vi.fn();
    renderCard({ onInterrupt });
    fireEvent.click(screen.getByRole("button", { name: /Interrupt/i }));
    expect(onInterrupt).toHaveBeenCalled();
  });

  it("calls onKill when button clicked", () => {
    const onKill = vi.fn();
    renderCard({ onKill });
    fireEvent.click(screen.getByRole("button", { name: /Kill/i }));
    expect(onKill).toHaveBeenCalled();
  });

  it("renders approve and reject buttons for permission_prompt status", () => {
    renderCard({
      session: { ...baseSession, status: "permission_prompt" } as SessionInfo,
    });
    expect(screen.getByRole("button", { name: /Approve/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reject/i })).toBeDefined();
  });

  it("calls onToggleSelect when checkbox changed", () => {
    const onToggleSelect = vi.fn();
    renderCard({ onToggleSelect });
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith("sess-tes2345678", true);
  });

  it("shows dead indicator when not alive", () => {
    renderCard({ isAlive: false });
    const deadIcon = document.querySelector("svg.lucide-circle-x");
    expect(deadIcon).not.toBeNull();
  });
});
