"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader, AlpacaError } from "@/src/lib/alpaca";
import { completeLessonsByAction } from "@/src/lib/lessonCompletion";

export async function closePosition(formData: FormData) {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) redirect("/login");

  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  const qty = String(formData.get("qty") ?? "").trim();
  const mode = String(formData.get("mode") ?? "full");

  try {
    const alpaca = alpacaForTrader(trader);
    if (mode === "partial" && qty) {
      await alpaca.closePosition(symbol, qty);
    } else {
      await alpaca.closePosition(symbol);
    }
  } catch (err) {
    const msg = err instanceof AlpacaError ? encodeURIComponent(err.message) : "error";
    redirect(`/positions/${symbol}?error=${msg}`);
  }

  await completeLessonsByAction(traderId, "close-position");
  redirect("/");
}
