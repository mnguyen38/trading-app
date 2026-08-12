"use client";
import { useState, useEffect } from "react";
import { saveSubscription, deleteSubscription } from "@/src/server/actions/push";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

type State = "unsupported" | "denied" | "off" | "loading" | "on";

export function NotificationToggle() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setState(sub ? "on" : "off");
      });
    });
  }, []);

  async function toggle() {
    setState("loading");
    const reg = await navigator.serviceWorker.ready;

    if (state === "on") {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deleteSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await saveSubscription(json);
      setState("on");
    } catch {
      setState("off");
    }
  }

  if (state === "unsupported") return null;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium">Order fill alerts</p>
        {state === "denied" && (
          <p className="mt-0.5 text-xs text-neutral-500">Notifications blocked — enable in browser settings.</p>
        )}
        {state !== "denied" && (
          <p className="mt-0.5 text-xs text-neutral-500">Get notified when orders execute.</p>
        )}
      </div>
      <button
        type="button"
        disabled={state === "loading" || state === "denied"}
        onClick={toggle}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
          state === "on" ? "bg-orange-500" : "bg-neutral-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            state === "on" ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
