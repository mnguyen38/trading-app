import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@/src/hooks/useLiveAccount", () => ({
  useLiveAccount: vi.fn(),
}));

vi.mock("@/src/hooks/usePriceStream", () => ({
  usePriceStream: vi.fn(),
}));

import { LiveDashboard } from "./LiveDashboard";
import { useLiveAccount } from "@/src/hooks/useLiveAccount";
import { usePriceStream } from "@/src/hooks/usePriceStream";

const aaplPosition = {
  symbol: "AAPL",
  qty: "10",
  side: "long" as const,
  avg_entry_price: "150.00",
  current_price: "160.00",
  market_value: "1600.00",
  unrealized_pl: "100.00",
  unrealized_plpc: "0.0625",
};

const mockAccount = {
  account_number: "PA123",
  status: "ACTIVE",
  cash: "5000.00",
  equity: "6600.00",
  buying_power: "8000.00",
  portfolio_value: "6600.00",
  pattern_day_trader: false,
  trading_blocked: false,
};

const liveAccountData = {
  account: mockAccount,
  positions: [aaplPosition],
  openOrders: [],
  isOpen: false,
  stale: false,
};

const defaultProps = {
  traderName: "Alice",
  accountNumber: "PA123",
  accountStatus: "ACTIVE",
  initialData: {
    account: mockAccount,
    positions: [aaplPosition],
    openOrders: [],
    isOpen: false,
  },
};

describe("LiveDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePriceStream).mockReturnValue({});
    vi.mocked(useLiveAccount).mockReturnValue(liveAccountData);
  });

  it("shows trader name in header", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
  });

  it("shows account number in footer", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/PA123/)).toBeInTheDocument();
  });

  it("shows cash balance", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText("$5,000.00")).toBeInTheDocument();
  });

  it("shows polled equity when no stream prices", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText("$6,600.00")).toBeInTheDocument();
  });

  it("shows stream-adjusted equity when live prices arrive", () => {
    // live $165, polled $160, qty 10 → delta +$50 → equity $6,650
    vi.mocked(usePriceStream).mockReturnValue({ AAPL: 165 });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText("$6,650.00")).toBeInTheDocument();
  });

  it("shows polled current price in position row when no stream data", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/now \$160\.00/)).toBeInTheDocument();
  });

  it("shows live price in position row when stream data exists", () => {
    vi.mocked(usePriceStream).mockReturnValue({ AAPL: 165 });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/now \$165\.00/)).toBeInTheDocument();
  });

  it("shows polled market value when no stream data", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText("$1,600.00")).toBeInTheDocument();
  });

  it("shows live market value when stream data exists", () => {
    // 165 * 10 = $1,650.00
    vi.mocked(usePriceStream).mockReturnValue({ AAPL: 165 });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText("$1,650.00")).toBeInTheDocument();
  });

  it("shows live position P&L when stream data exists", () => {
    // (165 - 150) * 10 = +$150.00 at +10.00% return on cost
    vi.mocked(usePriceStream).mockReturnValue({ AAPL: 165 });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText("+$150.00 (+10.00%)")).toBeInTheDocument();
  });

  it("does not show live-indicator dot next to ticker without stream data", () => {
    render(<LiveDashboard {...defaultProps} />);
    const dots = document.querySelectorAll(".opacity-70.animate-pulse");
    expect(dots).toHaveLength(0);
  });

  it("shows live-indicator dot next to ticker when stream data exists", () => {
    vi.mocked(usePriceStream).mockReturnValue({ AAPL: 165 });
    render(<LiveDashboard {...defaultProps} />);
    expect(document.querySelector(".opacity-70.animate-pulse")).toBeInTheDocument();
  });

  it("shows no dot for ticker whose symbol is not yet in stream, even when others are", () => {
    vi.mocked(useLiveAccount).mockReturnValue({
      ...liveAccountData,
      positions: [
        aaplPosition,
        { ...aaplPosition, symbol: "TSLA", current_price: "200.00", market_value: "2000.00" },
      ],
    });
    // Only AAPL has a stream price
    vi.mocked(usePriceStream).mockReturnValue({ AAPL: 165 });
    render(<LiveDashboard {...defaultProps} />);
    const dots = document.querySelectorAll(".opacity-70.animate-pulse");
    expect(dots).toHaveLength(1);
  });

  it("shows Reconnecting message when stale", () => {
    vi.mocked(useLiveAccount).mockReturnValue({ ...liveAccountData, stale: true });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });

  it("does not show Reconnecting when not stale", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
  });

  it("shows 'No open positions' when positions list is empty", () => {
    vi.mocked(useLiveAccount).mockReturnValue({
      ...liveAccountData,
      positions: [],
    });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument();
  });

  it("renders open orders section when orders are present", () => {
    vi.mocked(useLiveAccount).mockReturnValue({
      ...liveAccountData,
      openOrders: [
        {
          id: "order-1",
          client_order_id: "coid-1",
          symbol: "TSLA",
          side: "buy" as const,
          type: "market" as const,
          time_in_force: "day" as const,
          qty: "5",
          filled_qty: "0",
          filled_avg_price: null,
          status: "new" as const,
          limit_price: null,
          stop_price: null,
          submitted_at: "2024-01-01T10:00:00Z",
          filled_at: null,
          asset_class: "us_equity",
        },
      ],
    });
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.getByText(/open orders/i)).toBeInTheDocument();
    expect(screen.getByText("TSLA")).toBeInTheDocument();
  });

  it("does not render open orders section when no orders", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(screen.queryByText(/open orders/i)).not.toBeInTheDocument();
  });

  it("calls usePriceStream with symbols derived from positions", () => {
    render(<LiveDashboard {...defaultProps} />);
    expect(vi.mocked(usePriceStream)).toHaveBeenCalledWith(["AAPL"]);
  });

  it("calls usePriceStream with all position symbols", () => {
    vi.mocked(useLiveAccount).mockReturnValue({
      ...liveAccountData,
      positions: [
        aaplPosition,
        { ...aaplPosition, symbol: "NVDA", current_price: "880.00", market_value: "8800.00" },
      ],
    });
    render(<LiveDashboard {...defaultProps} />);
    expect(vi.mocked(usePriceStream)).toHaveBeenCalledWith(["AAPL", "NVDA"]);
  });

  it("calls usePriceStream with empty array when no positions", () => {
    vi.mocked(useLiveAccount).mockReturnValue({ ...liveAccountData, positions: [] });
    render(<LiveDashboard {...defaultProps} />);
    expect(vi.mocked(usePriceStream)).toHaveBeenCalledWith([]);
  });
});
