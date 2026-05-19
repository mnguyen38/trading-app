import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { LiveDashboard } from "@/src/components/trading/LiveDashboard";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) throw new Error(`Unknown trader id in session: ${traderId}`);

  const alpaca = alpacaForTrader(trader);
  const [account, positions, openOrders, clock] = await Promise.all([
    alpaca.getAccount(),
    alpaca.getPositions(),
    alpaca.getOrders("open"),
    alpaca.getClock(),
  ]);

  return (
    <LiveDashboard
      traderName={trader.name}
      accountNumber={account.account_number}
      accountStatus={account.status}
      initialData={{ account, positions, openOrders, isOpen: clock.is_open }}
    />
  );
}
