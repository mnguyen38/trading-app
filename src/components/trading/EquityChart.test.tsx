import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EquityChart } from "./EquityChart";
import type { ChartSeries } from "./EquityChart";

const twoSeries: ChartSeries[] = [
  {
    name: "Trader 1",
    color: "#fb923c",
    points: [
      { date: "2024-01-01", equity: 10000 },
      { date: "2024-01-02", equity: 10500 },
      { date: "2024-01-03", equity: 10200 },
    ],
  },
  {
    name: "Trader 2",
    color: "#38bdf8",
    points: [
      { date: "2024-01-01", equity: 9800 },
      { date: "2024-01-02", equity: 10100 },
      { date: "2024-01-03", equity: 10300 },
    ],
  },
];

describe("EquityChart", () => {
  it("renders an SVG", () => {
    const { container } = render(<EquityChart series={twoSeries} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders one path per series", () => {
    const { container } = render(<EquityChart series={twoSeries} />);
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  it("applies the correct stroke color to each series", () => {
    const { container } = render(<EquityChart series={twoSeries} />);
    const paths = container.querySelectorAll("path");
    expect(paths[0].getAttribute("stroke")).toBe("#fb923c");
    expect(paths[1].getAttribute("stroke")).toBe("#38bdf8");
  });

  it("renders a dot per data point per series", () => {
    const { container } = render(<EquityChart series={twoSeries} />);
    // 3 points × 2 series = 6 circles
    expect(container.querySelectorAll("circle").length).toBe(6);
  });

  it("renders nothing when all series are empty", () => {
    const { container } = render(
      <EquityChart series={[{ name: "A", color: "#fff", points: [] }]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when series array is empty", () => {
    const { container } = render(<EquityChart series={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("works with a single series and a single point", () => {
    const { container } = render(
      <EquityChart
        series={[{ name: "A", color: "#fff", points: [{ date: "2024-01-01", equity: 10000 }] }]}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  it("shows date labels on the x-axis", () => {
    render(<EquityChart series={twoSeries} />);
    // First and last date formatted as m/d
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("renders only one series path when one series has no points", () => {
    const { container } = render(
      <EquityChart
        series={[
          { name: "A", color: "#fb923c", points: [{ date: "2024-01-01", equity: 10000 }] },
          { name: "B", color: "#38bdf8", points: [] },
        ]}
      />
    );
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});
