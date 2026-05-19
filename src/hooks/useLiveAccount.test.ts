import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveAccount } from "./useLiveAccount";
import type { LiveData } from "./useLiveAccount";

const initial: LiveData = {
  account: {
    account_number: "PA123",
    status: "ACTIVE",
    cash: "5000",
    equity: "10000",
    buying_power: "5000",
    portfolio_value: "10000",
    pattern_day_trader: false,
    trading_blocked: false,
  },
  positions: [],
  openOrders: [],
  isOpen: false,
};

// Advance exactly one poll interval and flush the resulting async work.
async function tickOnce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
}

describe("useLiveAccount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns initial data immediately without fetching", () => {
    const { result } = renderHook(() => useLiveAccount(initial));
    expect(result.current.account.equity).toBe("10000");
    expect(result.current.positions).toEqual([]);
    expect(result.current.openOrders).toEqual([]);
  });

  it("starts with stale=false", () => {
    const { result } = renderHook(() => useLiveAccount(initial));
    expect(result.current.stale).toBe(false);
  });

  it("does not fetch before 10 seconds have passed", () => {
    renderHook(() => useLiveAccount(initial));
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("fetches /api/live after 10 seconds", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => initial } as Response);
    renderHook(() => useLiveAccount(initial));

    await tickOnce();

    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/live");
  });

  it("updates data when poll returns new values", async () => {
    const updated: LiveData = {
      ...initial,
      account: { ...initial.account, equity: "12500" },
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => updated,
    } as Response);

    const { result } = renderHook(() => useLiveAccount(initial));
    await tickOnce();

    expect(result.current.account.equity).toBe("12500");
    expect(result.current.stale).toBe(false);
  });

  it("sets stale=true and keeps last data when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLiveAccount(initial));
    await tickOnce();

    expect(result.current.stale).toBe(true);
    expect(result.current.account.equity).toBe("10000"); // stale data retained
  });

  it("sets stale=true when response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    const { result } = renderHook(() => useLiveAccount(initial));
    await tickOnce();

    expect(result.current.stale).toBe(true);
  });

  it("recovers stale=false after a successful poll following a failure", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue({ ok: true, json: async () => initial } as Response);

    const { result } = renderHook(() => useLiveAccount(initial));

    await tickOnce(); // fails → stale
    expect(result.current.stale).toBe(true);

    await tickOnce(); // succeeds → not stale
    expect(result.current.stale).toBe(false);
  });
});
