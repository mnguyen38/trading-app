"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader, AlpacaError } from "@/src/lib/alpaca";
import { db } from "@/src/db/client";
import { strategyTrades } from "@/src/db/schema";

export async function placeOptionOrder(formData: FormData) {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) redirect("/login");
  if (trader.type !== "micro") redirect("/strategies");

  const contractSymbol = String(formData.get("contract_symbol") ?? "").trim();
  const underlyingSymbol = String(formData.get("underlying_symbol") ?? "").trim().toUpperCase();
  const side = String(formData.get("side")) as "buy" | "sell";
  const orderType = String(formData.get("type")) as "market" | "limit";
  const tif = String(formData.get("tif")) as "day" | "gtc";
  const qty = String(formData.get("qty") ?? "").trim();
  const limitPrice = String(formData.get("limit_price") ?? "").trim();
  const strategySlug = String(formData.get("strategy_slug") ?? "").trim();

  if (!contractSymbol || !qty) redirect(`/trade/${underlyingSymbol || ""}?error=Missing+order+fields`);

  let order;
  try {
    order = await alpacaForTrader(trader).placeOptionOrder({
      symbol: contractSymbol,
      side,
      type: orderType,
      time_in_force: tif,
      qty,
      ...(orderType === "limit" && limitPrice ? { limit_price: limitPrice } : {}),
    });
  } catch (err) {
    const msg = err instanceof AlpacaError ? encodeURIComponent(err.message) : "error";
    redirect(`/trade/${underlyingSymbol}?error=${msg}&tab=options`);
  }

  if (strategySlug && order) {
    await db.insert(strategyTrades).values({
      id: crypto.randomUUID(),
      traderId,
      strategySlug,
      orderId: order.id,
      symbol: contractSymbol,
      side,
    });
  }

  redirect("/");
}
