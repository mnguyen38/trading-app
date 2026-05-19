import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePriceStream } from "./usePriceStream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  static reset() {
    MockEventSource.instances = [];
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("usePriceStream", () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty object initially", () => {
    const { result } = renderHook(() => usePriceStream(["AAPL"]));
    expect(result.current).toEqual({});
  });

  it("opens an EventSource with symbols sorted in the URL", () => {
    renderHook(() => usePriceStream(["TSLA", "AAPL"]));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/stream?symbols=AAPL,TSLA");
  });

  it("does not open EventSource when symbols array is empty", () => {
    renderHook(() => usePriceStream([]));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("updates price when a message arrives", () => {
    const { result } = renderHook(() => usePriceStream(["AAPL"]));
    act(() => {
      MockEventSource.instances[0].emit({ symbol: "AAPL", price: 195.5 });
    });
    expect(result.current["AAPL"]).toBe(195.5);
  });

  it("accumulates prices for multiple symbols", () => {
    const { result } = renderHook(() => usePriceStream(["AAPL", "TSLA"]));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit({ symbol: "AAPL", price: 195.5 });
      es.emit({ symbol: "TSLA", price: 250.0 });
    });
    expect(result.current["AAPL"]).toBe(195.5);
    expect(result.current["TSLA"]).toBe(250.0);
  });

  it("overwrites price when repeated ticks arrive for the same symbol", () => {
    const { result } = renderHook(() => usePriceStream(["AAPL"]));
    const es = MockEventSource.instances[0];
    act(() => { es.emit({ symbol: "AAPL", price: 195.5 }); });
    act(() => { es.emit({ symbol: "AAPL", price: 196.0 }); });
    expect(result.current["AAPL"]).toBe(196.0);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => usePriceStream(["AAPL"]));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.close).toHaveBeenCalledOnce();
  });

  it("opens a new EventSource when symbol set changes", () => {
    const { rerender } = renderHook(({ syms }) => usePriceStream(syms), {
      initialProps: { syms: ["AAPL"] },
    });
    rerender({ syms: ["AAPL", "TSLA"] });
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("closes old EventSource when symbol set changes", () => {
    const { rerender } = renderHook(({ syms }) => usePriceStream(syms), {
      initialProps: { syms: ["AAPL"] },
    });
    const first = MockEventSource.instances[0];
    rerender({ syms: ["TSLA"] });
    expect(first.close).toHaveBeenCalledOnce();
  });

  it("does not reopen EventSource when symbol order changes but set is identical", () => {
    const { rerender } = renderHook(({ syms }) => usePriceStream(syms), {
      initialProps: { syms: ["AAPL", "TSLA"] },
    });
    rerender({ syms: ["TSLA", "AAPL"] });
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("returns prices keyed by symbol name as received", () => {
    const { result } = renderHook(() => usePriceStream(["NVDA"]));
    act(() => {
      MockEventSource.instances[0].emit({ symbol: "NVDA", price: 880.25 });
    });
    expect(Object.keys(result.current)).toEqual(["NVDA"]);
    expect(result.current["NVDA"]).toBe(880.25);
  });
});
