import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioPie } from "./PortfolioPie";

const positions = [
  { symbol: "AAPL", market_value: "5000" },
  { symbol: "TSLA", market_value: "3000" },
];

describe("PortfolioPie", () => {
  it("renders an svg", () => {
    const { container } = render(
      <PortfolioPie positions={positions} equity={10000} cash={2000} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders a legend entry per position plus cash", () => {
    render(<PortfolioPie positions={positions} equity={10000} cash={2000} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("TSLA")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
  });

  it("shows percentages in legend", () => {
    render(<PortfolioPie positions={positions} equity={10000} cash={2000} />);
    // total = 5000 + 3000 + 2000 = 10000; AAPL = 50%
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
  });

  it("shows equity in center label", () => {
    render(<PortfolioPie positions={positions} equity={10000} cash={2000} />);
    expect(screen.getByText("$10.0k")).toBeInTheDocument();
  });

  it("renders nothing when total is zero", () => {
    const { container } = render(
      <PortfolioPie positions={[]} equity={0} cash={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders with a single position", () => {
    render(
      <PortfolioPie
        positions={[{ symbol: "NVDA", market_value: "8000" }]}
        equity={8000}
        cash={0}
      />
    );
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("filters out zero-value positions", () => {
    render(
      <PortfolioPie
        positions={[
          { symbol: "AAPL", market_value: "5000" },
          { symbol: "ZERO", market_value: "0" },
        ]}
        equity={5000}
        cash={0}
      />
    );
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.queryByText("ZERO")).not.toBeInTheDocument();
  });
});
