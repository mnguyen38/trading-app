import webpush from "web-push";

let initialised = false;

function getWebpush() {
  if (!initialised) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    initialised = true;
  }
  return webpush;
}

export { getWebpush as webpush };

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
