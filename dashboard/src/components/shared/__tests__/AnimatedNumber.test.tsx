import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnimatedNumber } from "../AnimatedNumber";

vi.mock("../../../hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => true,
}));

describe("AnimatedNumber", () => {
  it("renders the value", () => {
    render(<AnimatedNumber value={42} />);
    expect(screen.getByText("42")).toBeDefined();
  });

  it("renders with suffix", () => {
    render(<AnimatedNumber value={42} suffix="ms" />);
    expect(screen.getByText("42ms")).toBeDefined();
  });

  it("renders zero", () => {
    render(<AnimatedNumber value={0} />);
    expect(screen.getByText("0")).toBeDefined();
  });

  it("renders negative values", () => {
    render(<AnimatedNumber value={-5} />);
    expect(screen.getByText("-5")).toBeDefined();
  });

  it("renders with decimals", () => {
    render(<AnimatedNumber value={3.14159} decimals={2} />);
    expect(screen.getByText("3.14")).toBeDefined();
  });

  it("renders with percentage suffix", () => {
    render(<AnimatedNumber value={87} suffix="%" />);
    expect(screen.getByText("87%")).toBeDefined();
  });

  it("applies custom className", () => {
    render(<AnimatedNumber value={100} className="text-xl font-bold" />);
    const el = document.querySelector(".text-xl");
    expect(el).not.toBeNull();
  });
});
