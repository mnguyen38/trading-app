"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader, AlpacaError } from "@/src/lib/alpaca";
import type { PlaceOrderInput } from "@/src/lib/alpaca";
import { completeLessonsByAction } from "@/src/lib/lessonCompletion";

export async function goToSymbol(formData: FormData) {
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) redirect("/trade");
  redirect(`/trade/${symbol}`);
}

export async function placeOrder(formData: FormData) {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) redirect("/login");

  const symbol    = String(formData.get("symbol") ?? "").trim().toUpperCase();
  const side      = String(formData.get("side")) as "buy" | "sell";
  const orderType = String(formData.get("type")) as PlaceOrderInput["type"];
  const tif       = String(formData.get("tif")) as "day" | "gtc";
  const qtyMode   = String(formData.get("qty_mode")) as "shares" | "notional";
  const qtyValue  = String(formData.get("qty_value")).trim();
  const limitPrice = String(formData.get("limit_price") ?? "").trim();
  const stopPrice  = String(formData.get("stop_price") ?? "").trim();

  const input: PlaceOrderInput = { symbol, side, type: orderType, time_in_force: tif };

  if (qtyMode === "shares") input.qty = qtyValue;
  else input.notional = qtyValue;

  if (orderType === "limit" || orderType === "stop_limit") input.limit_price = limitPrice;
  if (orderType === "stop"  || orderType === "stop_limit") input.stop_price  = stopPrice;

  try {
    await alpacaForTrader(trader).placeOrder(input);
  } catch (err) {
    const msg = err instanceof AlpacaError ? encodeURIComponent(err.message) : "error";
    redirect(`/trade/${symbol}?error=${msg}`);
  }

  if (side === "buy") {
    const action = (orderType === "limit" || orderType === "stop_limit") ? "limit-order" : "buy-order";
    await completeLessonsByAction(traderId, action);
  }

  redirect("/");
}
