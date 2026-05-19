import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptTip } from "./ConceptTip";

describe("ConceptTip", () => {
  it("renders children text", () => {
    render(<ConceptTip id="limit-order">Limit price</ConceptTip>);
    expect(screen.getByText("Limit price")).toBeInTheDocument();
  });

  it("renders the ? badge", () => {
    render(<ConceptTip id="limit-order">Limit price</ConceptTip>);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("concept content is not visible before clicking", () => {
    render(<ConceptTip id="limit-order">Limit price</ConceptTip>);
    expect(screen.queryByText("Limit Order")).not.toBeInTheDocument();
  });

  it("shows concept label and description on click", async () => {
    render(<ConceptTip id="limit-order">Limit price</ConceptTip>);
    await userEvent.click(screen.getByText("Limit price"));
    // Both mobile sheet and desktop popover render in jsdom — at least one must exist
    expect(screen.getAllByText("Limit Order").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/only fills at your price or better/i).length).toBeGreaterThan(0);
  });

  it("shows example text on click", async () => {
    render(<ConceptTip id="limit-order">Limit price</ConceptTip>);
    await userEvent.click(screen.getByText("Limit price"));
    expect(screen.getAllByText("Example:").length).toBeGreaterThan(0);
  });

  it("shows 'Read the lesson →' for concepts with learnMore", async () => {
    render(<ConceptTip id="limit-order">Limit price</ConceptTip>);
    await userEvent.click(screen.getByText("Limit price"));
    expect(screen.getAllByText(/read the lesson/i).length).toBeGreaterThan(0);
  });

  it("does not show 'Read the lesson →' for concepts without learnMore", async () => {
    render(<ConceptTip id="market-order">Market order</ConceptTip>);
    await userEvent.click(screen.getByText("Market order"));
    expect(screen.queryByText(/read the lesson/i)).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    render(
      <div>
        <ConceptTip id="limit-order">Limit price</ConceptTip>
        <button>Outside</button>
      </div>
    );
    await userEvent.click(screen.getByText("Limit price"));
    expect(screen.getAllByText("Limit Order").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByText("Limit Order")).not.toBeInTheDocument();
  });

  it("toggles closed when clicking the trigger again", async () => {
    render(<ConceptTip id="market-order">Market order</ConceptTip>);
    await userEvent.click(screen.getByText("Market order"));
    expect(screen.getAllByText("Market Order").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByText("Market order"));
    expect(screen.queryByText("Market Order")).not.toBeInTheDocument();
  });

  it("works for a tier-3 concept", async () => {
    render(<ConceptTip id="short">Short selling</ConceptTip>);
    await userEvent.click(screen.getByText("Short selling"));
    expect(screen.getAllByText("Short").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/borrowing shares/i).length).toBeGreaterThan(0);
  });
});
