import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "session";

export function signToken(traderId: string, secret: string): string {
  return `${traderId}.${createHmac("sha256", secret).update(traderId).digest("hex")}`;
}

export function verifyToken(value: string, secret: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const traderId = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (mac.length !== 64) return null;
  const expected = createHmac("sha256", secret).update(traderId).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  return traderId;
}

function sign(traderId: string): string {
  return signToken(traderId, process.env.SESSION_SECRET!);
}

function verify(value: string): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return verifyToken(value, secret);
}

export async function setSession(traderId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, sign(traderId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1-hour idle timeout; middleware slides this on every request
    secure: process.env.NODE_ENV === "production",
  });
}

export async function getSession(): Promise<string> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) redirect("/login");
  const traderId = verify(value);
  if (!traderId) redirect("/login");
  return traderId;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
