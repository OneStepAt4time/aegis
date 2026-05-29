import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StreamTab } from "../StreamTab";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../AcpTerminalDebugView", () => ({
  AcpTerminalDebugView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-view">{sessionId}</div>
  ),
}));

vi.mock("../TranscriptView", () => ({
  TranscriptView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="transcript-view">{sessionId}</div>
  ),
}));

vi.mock("../StreamSplitView", () => ({
  StreamSplitView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="split-view">{sessionId}</div>
  ),
}));

vi.mock('../../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

function renderStreamTab(initialView?: string) {
  const search = initialView ? `?view=${initialView}` : "";
  return render(
    <MemoryRouter initialEntries={[`/sessions/test-session-123${search}`]}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<StreamTab sessionId="test-session-123" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StreamTab", () => {
  it("renders the view mode selector", () => {
    renderStreamTab();
    expect(screen.getByRole("tablist")).toBeDefined();
  });

  it("renders three view mode tabs", () => {
    renderStreamTab();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(3);
  });

  it("renders Terminal tab button", () => {
    renderStreamTab();
    expect(screen.getByRole("tab", { name: "Terminal" })).toBeDefined();
  });

  it("renders Transcript tab button", () => {
    renderStreamTab();
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeDefined();
  });

  it("renders Split tab button", () => {
    renderStreamTab();
    expect(screen.getByRole("tab", { name: "Split" })).toBeDefined();
  });

  it("renders View label", () => {
    renderStreamTab();
    expect(screen.getByText("View:")).toBeDefined();
  });

  it("switches to terminal view when Terminal tab clicked", () => {
    renderStreamTab("split");
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("terminal-view")).toBeDefined();
  });

  it("switches to transcript view when Transcript tab clicked", () => {
    renderStreamTab("split");
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    expect(screen.getByRole("tab", { name: "Transcript" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("transcript-view")).toBeDefined();
  });

  it("renders split view by default", () => {
    renderStreamTab();
    expect(screen.getByTestId("split-view")).toBeDefined();
  });

  it("respects initial view from URL param", () => {
    renderStreamTab("terminal");
    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe("true");
  });
});
