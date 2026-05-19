import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeForm } from "./TradeForm";

vi.mock("@/src/server/actions/trade", () => ({
  placeOrder: vi.fn(),
}));

const defaultProps = {
  symbol: "AAPL",
  price: 200,
  buyingPower: 10000,
};

describe("TradeForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Buy and Sell buttons", () => {
    render(<TradeForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell" })).toBeInTheDocument();
  });

  it("defaults to Buy side", () => {
    render(<TradeForm {...defaultProps} />);
    const submit = screen.getByRole("button", { name: /place buy order/i });
    expect(submit).toBeInTheDocument();
  });

  it("switches to Sell side", async () => {
    render(<TradeForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.getByRole("button", { name: /place sell order/i })).toBeInTheDocument();
  });

  it("defaults to Market order type — no limit/stop fields", () => {
    render(<TradeForm {...defaultProps} />);
    expect(screen.queryByLabelText(/limit price/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/stop price/i)).not.toBeInTheDocument();
  });

  it("shows limit price field when Limit is selected", async () => {
    render(<TradeForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Limit" }));
    expect(screen.getByLabelText(/limit price/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/stop price/i)).not.toBeInTheDocument();
  });

  it("shows stop price field when Stop is selected", async () => {
    render(<TradeForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByLabelText(/stop price/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/limit price/i)).not.toBeInTheDocument();
  });

  it("shows both price fields for Stop-Limit", async () => {
    render(<TradeForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop-Limit" }));
    expect(screen.getByLabelText(/limit price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop price/i)).toBeInTheDocument();
  });

  it("hides TIF selector for market orders", () => {
    render(<TradeForm {...defaultProps} />);
    expect(screen.queryByText(/good till cancelled/i)).not.toBeInTheDocument();
  });

  it("shows TIF selector for limit orders", async () => {
    render(<TradeForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Limit" }));
    expect(screen.getByText(/good till cancelled/i)).toBeInTheDocument();
  });

  it("toggles quantity mode between Shares and Dollars", async () => {
    render(<TradeForm {...defaultProps} />);
    const dollarBtn = screen.getByRole("button", { name: "Dollars" });
    await userEvent.click(dollarBtn);
    expect(screen.getByText("$")).toBeInTheDocument();
  });

  it("displays buying power", () => {
    render(<TradeForm {...defaultProps} />);
    expect(screen.getByText(/buying power/i)).toBeInTheDocument();
    expect(screen.getByText(/\$10,000\.00/)).toBeInTheDocument();
  });

  it("shows error message when error prop is set", () => {
    render(<TradeForm {...defaultProps} error="Insufficient funds" />);
    expect(screen.getByText("Insufficient funds")).toBeInTheDocument();
  });

  it("does not show error when error prop is absent", () => {
    render(<TradeForm {...defaultProps} />);
    expect(screen.queryByText(/insufficient/i)).not.toBeInTheDocument();
  });

  it("pre-fills limit price with current price", async () => {
    render(<TradeForm {...defaultProps} price={199.99} />);
    await userEvent.click(screen.getByRole("button", { name: "Limit" }));
    const input = screen.getByLabelText(/limit price/i) as HTMLInputElement;
    expect(input.value).toBe("199.99");
  });

  it("renders symbol as hidden input", () => {
    const { container } = render(<TradeForm {...defaultProps} />);
    const symbolInput = container.querySelector('input[name="symbol"]') as HTMLInputElement;
    expect(symbolInput?.value).toBe("AAPL");
  });
});
