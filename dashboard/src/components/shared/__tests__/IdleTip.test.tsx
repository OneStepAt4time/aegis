import { describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { IdleTip } from "../IdleTip";

describe("IdleTip", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(<IdleTip show={false} tip="Try something" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tip text when show is true", async () => {
    await act(async () => {
      render(<IdleTip show={true} tip="Try pressing Ctrl+K" />);
    });
    expect(screen.getByText("Try pressing Ctrl+K")).toBeDefined();
  });

  it("renders lightbulb icon when visible", async () => {
    await act(async () => {
      render(<IdleTip show={true} tip="A helpful tip" />);
    });
    const icon = document.querySelector("svg.lucide-lightbulb");
    expect(icon).not.toBeNull();
  });
});
