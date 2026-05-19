"use server";
import { redirect } from "next/navigation";
import { verifyTraderPasscode } from "@/src/lib/traders";
import { setSession, clearSession } from "@/src/lib/auth";

export async function login(formData: FormData) {
  const traderId = String(formData.get("traderId") ?? "").trim();
  const passcode = String(formData.get("passcode") ?? "").trim();
  const trader = await verifyTraderPasscode(traderId, passcode);
  if (!trader) redirect("/login?error=1");
  await setSession(trader.id);
  redirect("/");
}

export async function logout() {
  await clearSession();
  redirect("/login");
}
