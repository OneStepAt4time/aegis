import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffortIndicator } from "../EffortIndicator";

describe("EffortIndicator", () => {
  it("renders nothing when effort is undefined", () => {
    const { container } = render(<EffortIndicator />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when effort is null", () => {
    const { container } = render(<EffortIndicator effort={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders High label for high effort", () => {
    render(<EffortIndicator effort="high" />);
    expect(screen.getByText("High")).toBeDefined();
  });

  it("renders Med label for medium effort", () => {
    render(<EffortIndicator effort="medium" />);
    expect(screen.getByText("Med")).toBeDefined();
  });

  it("renders Low label for low effort", () => {
    render(<EffortIndicator effort="low" />);
    expect(screen.getByText("Low")).toBeDefined();
  });

  it("renders High for numeric effort >= 0.7", () => {
    render(<EffortIndicator effort="0.8" />);
    expect(screen.getByText("High")).toBeDefined();
  });

  it("renders Med for numeric effort >= 0.3", () => {
    render(<EffortIndicator effort="0.5" />);
    expect(screen.getByText("Med")).toBeDefined();
  });

  it("renders Low for numeric effort < 0.3", () => {
    render(<EffortIndicator effort="0.1" />);
    expect(screen.getByText("Low")).toBeDefined();
  });

  it("renders raw effort for unknown values", () => {
    render(<EffortIndicator effort="custom" />);
    expect(screen.getByText("custom")).toBeDefined();
  });

  it("sets title attribute", () => {
    render(<EffortIndicator effort="high" />);
    const el = screen.getByText("High").parentElement;
    expect(el!.getAttribute("title")).toBe("Effort: high");
  });

  it("is case-insensitive", () => {
    render(<EffortIndicator effort="HIGH" />);
    expect(screen.getByText("High")).toBeDefined();
  });
});
