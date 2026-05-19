"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader, AlpacaError } from "@/src/lib/alpaca";

export async function cancelOrder(formData: FormData) {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) redirect("/login");

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) redirect("/orders");

  try {
    await alpacaForTrader(trader).cancelOrder(orderId);
  } catch (err) {
    const msg = err instanceof AlpacaError ? encodeURIComponent(err.message) : "error";
    redirect(`/orders?error=${msg}`);
  }

  redirect("/orders");
}
