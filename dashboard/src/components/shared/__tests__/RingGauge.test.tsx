import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { RingGauge } from "../RingGauge";

vi.mock("../../../hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => true,
}));

vi.mock("../../../design/tokens", () => ({
  tokens: {
    glamour: {
      gaugeSpring: { stiffness: 120, damping: 20, mass: 1 },
      gaugeGradientId: "test-gauge-grad",
      gaugeGlowId: "test-gauge-glow",
      gaugeGlowBlur: 8,
    },
  },
}));

describe("RingGauge", () => {
  it("renders SVG element", () => {
    render(<RingGauge value={75} />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("displays value as percentage", async () => {
    await act(async () => {
      render(<RingGauge value={75} />);
    });
    expect(screen.getByText("75%")).toBeDefined();
  });

  it("displays zero percent", async () => {
    await act(async () => {
      render(<RingGauge value={0} />);
    });
    expect(screen.getByText("0%")).toBeDefined();
  });

  it("displays 100 percent", async () => {
    await act(async () => {
      render(<RingGauge value={100} />);
    });
    expect(screen.getByText("100%")).toBeDefined();
  });

  it("renders label when provided", async () => {
    await act(async () => {
      render(<RingGauge value={50} label="Efficiency" />);
    });
    expect(screen.getByText("Efficiency")).toBeDefined();
  });

  it("does not render label when not provided", async () => {
    await act(async () => {
      render(<RingGauge value={50} />);
    });
    expect(screen.queryByText("Efficiency")).toBeNull();
  });

  it("renders track circle", async () => {
    await act(async () => {
      render(<RingGauge value={50} />);
    });
    const svg = document.querySelector("svg");
    const circles = svg?.querySelectorAll("circle");
    expect(circles!.length).toBeGreaterThanOrEqual(2);
  });

  it("renders gradient definition", async () => {
    await act(async () => {
      render(<RingGauge value={50} />);
    });
    const svg = document.querySelector("svg");
    const defs = svg?.querySelector("defs");
    expect(defs).not.toBeNull();
  });
});
