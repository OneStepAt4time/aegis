import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LiveAuditStream from "../components/shared/LiveAuditStream";
import { MemoryRouter } from "react-router-dom";

vi.mock("../store/useStore", () => ({
  useStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    activities: [],
    sseConnected: false,
    sseError: null,
  }),
}));

vi.mock("../design/tokens", () => ({
  tokens: {
    glamour: {
      sideRailMaxEvents: 50,
    },
  },
}));

function renderStream() {
  return render(
    <MemoryRouter>
      <LiveAuditStream />
    </MemoryRouter>,
  );
}

describe("LiveAuditStream", () => {
  it("renders the aside element", () => {
    renderStream();
    expect(screen.getByRole("complementary")).toBeDefined();
  });

  it("renders the header text", () => {
    renderStream();
    expect(screen.getByText("Live Stream")).toBeDefined();
  });

  it("renders empty state when no events", () => {
    renderStream();
    expect(screen.getByText("Waiting for events…")).toBeDefined();
  });

  it("renders event count in footer", () => {
    renderStream();
    expect(screen.getByText("0 events")).toBeDefined();
  });
});
