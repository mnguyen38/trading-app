import { describe, it, expect } from "vitest";
import { money, pct, num, signed } from "./format";

describe("money()", () => {
  it("formats positive number", () => expect(money(1234.56)).toBe("$1,234.56"));
  it("formats zero", () => expect(money(0)).toBe("$0.00"));
  it("formats negative", () => expect(money(-99.5)).toBe("-$99.50"));
  it("formats string input", () => expect(money("200.1")).toBe("$200.10"));
  it("returns — for NaN", () => expect(money(NaN)).toBe("—"));
  it("returns — for non-numeric string", () => expect(money("abc")).toBe("—"));
  it("respects custom digits", () => expect(money(1.5, 0)).toBe("$2"));
  it("formats large numbers with commas", () => expect(money(1_000_000)).toBe("$1,000,000.00"));
});

describe("pct()", () => {
  it("formats 0.05 as 5.00%", () => expect(pct(0.05)).toBe("5.00%"));
  it("formats 0 as 0.00%", () => expect(pct(0)).toBe("0.00%"));
  it("formats negative", () => expect(pct(-0.123)).toBe("-12.30%"));
  it("formats string input", () => expect(pct("0.1")).toBe("10.00%"));
  it("returns — for NaN", () => expect(pct(NaN)).toBe("—"));
  it("respects custom digits", () => expect(pct(0.1234, 1)).toBe("12.3%"));
});

describe("num()", () => {
  it("formats integer", () => expect(num(1000)).toBe("1,000"));
  it("formats fractional shares", () => expect(num(0.1234)).toBe("0.1234"));
  it("trims trailing zeros up to 4 decimals", () => expect(num(1.5)).toBe("1.5"));
  it("formats string input", () => expect(num("42")).toBe("42"));
  it("returns — for NaN", () => expect(num(NaN)).toBe("—"));
});

describe("signed()", () => {
  it("prefixes positive with +", () => expect(signed(10, n => `${n}`)).toBe("+10"));
  it("prefixes negative with −", () => expect(signed(-10, n => `${n}`)).toBe("−10"));
  it("treats zero as positive", () => expect(signed(0, n => `${n}`)).toBe("+0"));
  it("passes absolute value to formatter", () => {
    expect(signed(-50, n => money(n))).toBe("−$50.00");
  });
  it("works with pct formatter", () => {
    expect(signed(0.05, n => pct(n))).toBe("+5.00%");
  });
  it("returns — for NaN", () => expect(signed(NaN, n => `${n}`)).toBe("—"));
});
