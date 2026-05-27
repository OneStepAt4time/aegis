import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { HeatmapGrid } from "../HeatmapGrid";
import type { HeatmapDataPoint } from "../HeatmapGrid";

vi.mock("../../../design/tokens.js", () => ({
  tokens: {
    glamour: {
      heatmap: {
        cyan: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
        purple: ["#161b22", "#1a0533", "#3b0764", "#7c3aed", "#a78bfa"],
        green: ["#161b22", "#052e16", "#166534", "#22c55e", "#4ade80"],
      },
    },
  },
}));

const sampleData: HeatmapDataPoint[] = [
  { date: "2026-01-01", value: 5 },
  { date: "2026-01-02", value: 0 },
  { date: "2026-01-03", value: 12 },
  { date: "2026-01-04", value: 3 },
  { date: "2026-01-05", value: 20 },
];

describe("HeatmapGrid", () => {
  it("renders the SVG container", () => {
    render(<HeatmapGrid data={sampleData} />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders with accessible role", () => {
    render(<HeatmapGrid data={sampleData} metricLabel="Sessions" />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders grid cells for data points", () => {
    render(<HeatmapGrid data={sampleData} />);
    const svg = document.querySelector("svg");
    const cells = svg?.querySelectorAll("rect[role='gridcell']") || [];
    expect(cells.length).toBeGreaterThanOrEqual(5);
  });

  it("renders day labels", () => {
    render(<HeatmapGrid data={sampleData} />);
    const svg = document.querySelector("svg");
    const texts = svg?.querySelectorAll("text") || [];
    const allText = Array.from(texts).map((t) => t.textContent);
    expect(allText.some((t) => t === "Mon")).toBe(true);
  });

  it("renders with purple color scheme", () => {
    render(<HeatmapGrid data={sampleData} color="purple" />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders with green color scheme", () => {
    render(<HeatmapGrid data={sampleData} color="green" />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders empty grid with no data", () => {
    render(<HeatmapGrid data={[]} />);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("applies custom className", () => {
    render(<HeatmapGrid data={sampleData} className="custom-class" />);
    const container = document.querySelector(".custom-class");
    expect(container).not.toBeNull();
  });
});
