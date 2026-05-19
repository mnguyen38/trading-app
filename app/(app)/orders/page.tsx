import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader, type Order } from "@/src/lib/alpaca";
import { money } from "@/src/lib/format";
import { cancelOrder } from "@/src/server/actions/order";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  filled:           "text-green-400",
  partially_filled: "text-green-400",
  canceled:         "text-neutral-500",
  expired:          "text-neutral-500",
  rejected:         "text-red-400",
  new:              "text-orange-400",
  accepted:         "text-orange-400",
  pending_new:      "text-orange-400",
};

const CANCELLABLE = new Set([
  "new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled",
]);

function statusColor(status: string) {
  return STATUS_COLOR[status] ?? "text-neutral-400";
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) return null;

  const orders = await alpacaForTrader(trader).getOrders("all", 100);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Orders</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {decodeURIComponent(error)}
        </div>
      )}

      {orders.length === 0 ? (
        <p className="text-sm text-neutral-500">No orders yet.</p>
      ) : (
        <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
          {orders.map(o => <OrderRow key={o.id} order={o} />)}
        </div>
      )}
    </main>
  );
}

function OrderRow({ order: o }: { order: Order }) {
  const filled = parseFloat(o.filled_qty ?? "0") > 0;
  const canCancel = CANCELLABLE.has(o.status);

  return (
    <div className="flex items-start justify-between px-4 py-3.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={o.side === "buy" ? "font-semibold text-green-400" : "font-semibold text-red-400"}>
            {o.side.toUpperCase()}
          </span>
          <span className="font-semibold">{o.symbol}</span>
          <span className="text-xs text-neutral-500">{o.type}</span>
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">
          {o.qty ? `${o.qty} shares` : "—"}
          {o.limit_price ? ` · limit ${money(o.limit_price)}` : ""}
          {o.stop_price  ? ` · stop ${money(o.stop_price)}`  : ""}
          {filled ? ` · filled @ ${money(o.filled_avg_price!)}` : ""}
        </div>
        <div className="mt-0.5 text-xs text-neutral-600">
          {new Date(o.submitted_at).toLocaleDateString("en-US", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      </div>

      <div className="ml-4 flex shrink-0 flex-col items-end gap-2">
        <span className={`text-xs font-medium ${statusColor(o.status)}`}>
          {o.status.replace(/_/g, " ")}
        </span>
        {canCancel && (
          <form action={cancelOrder}>
            <input type="hidden" name="orderId" value={o.id} />
            <button
              type="submit"
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 transition hover:border-red-500/50 hover:text-red-400"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
