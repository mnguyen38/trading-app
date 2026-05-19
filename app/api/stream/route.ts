import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";

export const dynamic = "force-dynamic";

const ALPACA_WS = "wss://stream.data.alpaca.markets/v2/iex";

type AlpacaMsg = { T: string; msg?: string; S?: string; p?: number };

export async function GET(req: NextRequest) {
  // Auth — same pattern as /api/live
  const store = await cookies();
  const value = store.get("session")?.value;
  const secret = process.env.SESSION_SECRET;
  if (!value || !secret) return new Response("Unauthorized", { status: 401 });

  const traderId = verifyToken(value, secret);
  if (!traderId) return new Response("Unauthorized", { status: 401 });

  const trader = await getTraderById(traderId);
  if (!trader) return new Response("Unauthorized", { status: 401 });

  const symbols = (req.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) return new Response("No symbols", { status: 400 });

  const key    = process.env[`ALPACA_TRADING_KEY_ID_${trader.accountKey}`];
  const apiSecret = process.env[`ALPACA_TRADING_SECRET_${trader.accountKey}`];
  if (!key || !apiSecret) return new Response("Missing Alpaca keys", { status: 500 });

  const encoder = new TextEncoder();
  let alpacaWs: WebSocket;

  const stream = new ReadableStream({
    start(controller) {
      function send(data: unknown) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      }

      function close() {
        try { controller.close(); } catch { /* already closed */ }
      }

      alpacaWs = new WebSocket(ALPACA_WS);

      alpacaWs.addEventListener("open", () => {
        alpacaWs.send(JSON.stringify({ action: "auth", key, secret: apiSecret }));
      });

      alpacaWs.addEventListener("message", (event) => {
        let messages: AlpacaMsg[];
        try {
          messages = JSON.parse(event.data as string);
        } catch {
          return;
        }

        for (const msg of messages) {
          if (msg.T === "success" && msg.msg === "authenticated") {
            alpacaWs.send(JSON.stringify({ action: "subscribe", trades: symbols }));
          } else if (msg.T === "t" && msg.S && msg.p !== undefined) {
            send({ symbol: msg.S, price: msg.p });
          }
        }
      });

      alpacaWs.addEventListener("error", close);
      alpacaWs.addEventListener("close", close);
    },

    cancel() {
      alpacaWs?.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":    "text/event-stream",
      "Cache-Control":   "no-cache, no-transform",
      "Connection":      "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
