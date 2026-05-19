import { NextRequest, NextResponse } from "next/server";

const COOKIE = "session";

async function verifySession(value: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const traderId = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (mac.length !== 64) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let macBytes: Uint8Array<ArrayBuffer>;
  try {
    macBytes = new Uint8Array(mac.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, macBytes, encoder.encode(traderId));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const value = request.cookies.get(COOKIE)?.value;
  const authenticated = value ? await verifySession(value) : false;

  if (pathname.startsWith("/login")) {
    return authenticated
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  if (!authenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Slide the session: every valid request resets the 1-hour idle clock.
  const response = NextResponse.next();
  response.cookies.set(COOKIE, value!, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|sw\\.js|icons|manifest\\.webmanifest).*)"],
};
