import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isNYSEOpen } from "./marketHours";

describe("isNYSEOpen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Helpers — all dates in 2024-10-15 (Tuesday, EDT = UTC-4)
  //           and 2025-01-15 (Wednesday, EST = UTC-5)
  function setEDT(h: number, m = 0) {
    // EDT offset is UTC-4: ET hour h = UTC h+4
    vi.setSystemTime(new Date(`2024-10-15T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`));
  }
  function setEST(h: number, m = 0) {
    // EST offset is UTC-5: ET hour h = UTC h+5
    vi.setSystemTime(new Date(`2025-01-15T${String(h + 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`));
  }

  it("returns true at 10:00am ET on a Tuesday (EDT)", () => {
    setEDT(10);
    expect(isNYSEOpen()).toBe(true);
  });

  it("returns true at market open 9:30am ET", () => {
    setEDT(9, 30);
    expect(isNYSEOpen()).toBe(true);
  });

  it("returns false at 9:29am ET — one minute before open", () => {
    setEDT(9, 29);
    expect(isNYSEOpen()).toBe(false);
  });

  it("returns true at 3:59pm ET — one minute before close", () => {
    setEDT(15, 59);
    expect(isNYSEOpen()).toBe(true);
  });

  it("returns false at 4:00pm ET — market close", () => {
    setEDT(16, 0);
    expect(isNYSEOpen()).toBe(false);
  });

  it("returns false at 6:00pm ET — after hours", () => {
    setEDT(18);
    expect(isNYSEOpen()).toBe(false);
  });

  it("returns false at 8:00am ET — pre-market", () => {
    setEDT(8);
    expect(isNYSEOpen()).toBe(false);
  });

  it("returns false on Saturday", () => {
    // 2024-10-19 is a Saturday
    vi.setSystemTime(new Date("2024-10-19T14:00:00Z")); // 10am EDT
    expect(isNYSEOpen()).toBe(false);
  });

  it("returns false on Sunday", () => {
    // 2024-10-20 is a Sunday
    vi.setSystemTime(new Date("2024-10-20T14:00:00Z")); // 10am EDT
    expect(isNYSEOpen()).toBe(false);
  });

  it("works correctly in EST (winter — UTC-5)", () => {
    setEST(10); // 10am EST = 15:00 UTC
    expect(isNYSEOpen()).toBe(true);
  });

  it("returns true at 9:30am EST", () => {
    setEST(9, 30);
    expect(isNYSEOpen()).toBe(true);
  });

  it("returns false at 4:00pm EST", () => {
    setEST(16, 0);
    expect(isNYSEOpen()).toBe(false);
  });
});
