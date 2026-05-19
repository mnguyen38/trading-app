import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/src/lib/marketHours", () => ({
  isNYSEOpen: vi.fn(),
}));

import { MarketStatus } from "./MarketStatus";
import { isNYSEOpen } from "@/src/lib/marketHours";

describe("MarketStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows "OPEN" when market is open', () => {
    vi.mocked(isNYSEOpen).mockReturnValue(true);
    render(<MarketStatus />);
    expect(screen.getByText("OPEN")).toBeInTheDocument();
  });

  it('shows "CLOSED" when market is closed', () => {
    vi.mocked(isNYSEOpen).mockReturnValue(false);
    render(<MarketStatus />);
    expect(screen.getByText("CLOSED")).toBeInTheDocument();
  });

  it("applies green color when open", () => {
    vi.mocked(isNYSEOpen).mockReturnValue(true);
    render(<MarketStatus />);
    expect(screen.getByText("OPEN")).toHaveClass("text-green-400");
  });

  it("applies orange color when closed", () => {
    vi.mocked(isNYSEOpen).mockReturnValue(false);
    render(<MarketStatus />);
    expect(screen.getByText("CLOSED")).toHaveClass("text-orange-400");
  });

  it("does not show CLOSED when open", () => {
    vi.mocked(isNYSEOpen).mockReturnValue(true);
    render(<MarketStatus />);
    expect(screen.queryByText("CLOSED")).not.toBeInTheDocument();
  });

  it("does not show OPEN when closed", () => {
    vi.mocked(isNYSEOpen).mockReturnValue(false);
    render(<MarketStatus />);
    expect(screen.queryByText("OPEN")).not.toBeInTheDocument();
  });
});
