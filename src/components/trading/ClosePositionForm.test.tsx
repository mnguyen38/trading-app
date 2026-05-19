import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClosePositionForm } from "./ClosePositionForm";

vi.mock("@/src/server/actions/position", () => ({
  closePosition: vi.fn(),
}));

const defaultProps = { symbol: "AAPL", qty: "10" };

describe("ClosePositionForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Close All and Partial Close buttons", () => {
    render(<ClosePositionForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Close All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Partial Close" })).toBeInTheDocument();
  });

  it("defaults to full close — no qty input", () => {
    render(<ClosePositionForm {...defaultProps} />);
    expect(screen.queryByLabelText(/shares to close/i)).not.toBeInTheDocument();
  });

  it("submit button says Close AAPL in full mode", () => {
    render(<ClosePositionForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Close AAPL" })).toBeInTheDocument();
  });

  it("shows qty input when Partial Close is selected", async () => {
    render(<ClosePositionForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Partial Close" }));
    expect(screen.getByLabelText(/shares to close/i)).toBeInTheDocument();
  });

  it("qty input has correct max from props", async () => {
    render(<ClosePositionForm {...defaultProps} qty="25.5" />);
    await userEvent.click(screen.getByRole("button", { name: "Partial Close" }));
    const input = screen.getByLabelText(/shares to close/i) as HTMLInputElement;
    expect(input.max).toBe("25.5");
  });

  it("submit button says Close Partial in partial mode", async () => {
    render(<ClosePositionForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Partial Close" }));
    expect(screen.getByRole("button", { name: "Close Partial" })).toBeInTheDocument();
  });

  it("shows max qty hint in label", async () => {
    render(<ClosePositionForm {...defaultProps} qty="10" />);
    await userEvent.click(screen.getByRole("button", { name: "Partial Close" }));
    expect(screen.getByText(/max 10/i)).toBeInTheDocument();
  });

  it("shows error when error prop is set", () => {
    render(<ClosePositionForm {...defaultProps} error="Order rejected" />);
    expect(screen.getByText("Order rejected")).toBeInTheDocument();
  });

  it("symbol hidden input is correct", () => {
    const { container } = render(<ClosePositionForm {...defaultProps} />);
    const input = container.querySelector('input[name="symbol"]') as HTMLInputElement;
    expect(input?.value).toBe("AAPL");
  });

  it("can switch back to full close after selecting partial", async () => {
    render(<ClosePositionForm {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Partial Close" }));
    expect(screen.getByLabelText(/shares to close/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close All" }));
    expect(screen.queryByLabelText(/shares to close/i)).not.toBeInTheDocument();
  });
});
