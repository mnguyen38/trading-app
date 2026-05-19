import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/src/server/actions/learn", () => ({
  markLessonComplete: vi.fn(),
}));

import { MarkCompleteButton } from "./MarkCompleteButton";

describe("MarkCompleteButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows "Mark as complete" button when not done', () => {
    render(<MarkCompleteButton slug="pnl" done={false} />);
    expect(screen.getByRole("button", { name: /mark as complete/i })).toBeInTheDocument();
  });

  it("renders a form with a hidden slug input when not done", () => {
    const { container } = render(<MarkCompleteButton slug="pnl" done={false} />);
    const input = container.querySelector('input[name="slug"]') as HTMLInputElement;
    expect(input?.value).toBe("pnl");
  });

  it("shows completed state when done", () => {
    render(<MarkCompleteButton slug="pnl" done={true} />);
    expect(screen.getByText(/lesson complete/i)).toBeInTheDocument();
  });

  it("shows checkmark in completed state", () => {
    render(<MarkCompleteButton slug="pnl" done={true} />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("does not show a button when done", () => {
    render(<MarkCompleteButton slug="pnl" done={true} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not show completed text when not done", () => {
    render(<MarkCompleteButton slug="pnl" done={false} />);
    expect(screen.queryByText(/lesson complete/i)).not.toBeInTheDocument();
  });

  it("uses the correct slug for different lessons", () => {
    const { container } = render(<MarkCompleteButton slug="valuation-basics" done={false} />);
    const input = container.querySelector('input[name="slug"]') as HTMLInputElement;
    expect(input?.value).toBe("valuation-basics");
  });
});
