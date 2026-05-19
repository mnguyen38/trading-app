import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { logout } from "@/src/server/actions/auth";

export default async function SettingsPage() {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);

  return (
    <main className="mx-auto max-w-sm px-5 py-10">
      <h1 className="mb-8 text-2xl font-bold">Settings</h1>

      {/* Account */}
      <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 divide-y divide-neutral-800">
        <div className="px-4 py-3">
          <p className="text-xs text-neutral-500">Signed in as</p>
          <p className="mt-0.5 font-semibold">{trader?.name ?? traderId}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-neutral-500">Account</p>
          <p className="mt-0.5 font-mono text-sm text-neutral-300">{trader?.accountKey ?? "—"}</p>
        </div>
      </section>

      {/* Future settings placeholder */}
      <section className="mb-8 rounded-xl border border-dashed border-neutral-800 px-4 py-5 text-center text-sm text-neutral-600">
        More settings coming soon.
      </section>

      {/* Logout */}
      <form action={logout}>
        <button
          type="submit"
          className="w-full rounded-xl border border-red-900 bg-red-950/40 py-3 text-sm font-semibold text-red-400 transition hover:bg-red-950 hover:text-red-300"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
