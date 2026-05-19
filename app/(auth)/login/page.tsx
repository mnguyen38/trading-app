import { getAllTraders } from "@/src/lib/traders";
import { login } from "@/src/server/actions/auth";

const GREETINGS_SELECT = [
  "Who's trading today?",
  "Welcome back.",
  "Ready to trade?",
  "Let's make some moves.",
  "Markets are open.",
  "Good to see you.",
  "Time to trade.",
  "Who are you?",
  "Step right up.",
  "Make your pick.",
];

const GREETINGS_PASSCODE = [
  (name: string) => `Hey ${name} — enter your passcode.`,
  (name: string) => `Welcome back, ${name}.`,
  (name: string) => `Good to see you, ${name}.`,
  (name: string) => `${name} — what's the code?`,
  (name: string) => `Ready, ${name}?`,
  (name: string) => `Let's go, ${name}.`,
  (name: string) => `${name} — you know what to do.`,
  (name: string) => `Back again, ${name}.`,
];

function isNYSEOpen(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const hour = parseInt(get("hour"));
  const minute = parseInt(get("minute"));
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour > 9 || (hour === 9 && minute >= 30) ? hour < 16 : false;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; trader?: string }>;
}) {
  const { error, trader: selectedId } = await searchParams;
  const allTraders = await getAllTraders();
  const selectedTrader = allTraders.find(t => t.id === selectedId);

  return (
    <main className="safe-top safe-bottom flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-xs">
        <h1 className="mb-1 text-3xl font-bold">Trading Lab</h1>

        {!selectedTrader ? (
          <>
            <p className="mb-8 text-sm text-neutral-400">
              {pick(isNYSEOpen() ? GREETINGS_SELECT : GREETINGS_SELECT.filter(g => g !== "Markets are open."))}
            </p>
            <div className="flex flex-col gap-3">
              {allTraders.map(t => (
                <a
                  key={t.id}
                  href={`/login?trader=${t.id}`}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-4 text-center text-lg font-semibold transition hover:border-neutral-500 hover:bg-neutral-800"
                >
                  {t.name}
                </a>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mb-8 text-sm text-neutral-400">
              {pick(GREETINGS_PASSCODE)(selectedTrader.name)}
            </p>

            {error && (
              <p className="mb-4 rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400">
                Wrong passcode. Try again.
              </p>
            )}

            <form action={login} className="flex flex-col gap-3">
              <input type="hidden" name="traderId" value={selectedTrader.id} />
              <input
                type="password"
                name="passcode"
                inputMode="numeric"
                placeholder="Passcode"
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-center text-2xl font-mono tracking-widest caret-transparent placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              />
              <button
                type="submit"
                className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.98]"
              >
                Enter
              </button>
            </form>

            <a
              href="/login"
              className="mt-5 block text-center text-sm text-neutral-400 hover:text-white"
            >
              ← Back
            </a>
          </>
        )}
      </div>
    </main>
  );
}
