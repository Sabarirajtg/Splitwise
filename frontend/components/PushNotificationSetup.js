import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { showToast } from "../lib/toast";
import LoadingButton from "./LoadingButton";

function supportsPush() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const result = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) result[index] = raw.charCodeAt(index);
  return result;
}

export default function PushNotificationSetup({ userId }) {
  const [status, setStatus] = useState("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkStatus() {
      if (!supportsPush()) {
        if (active) setStatus("unsupported");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = registration && await registration.pushManager.getSubscription();
        if (subscription) {
          await api.savePushSubscription(subscription.toJSON());
          if (active) setStatus("enabled");
        } else if (active && Notification.permission === "denied") {
          setStatus("denied");
        } else if (active) {
          setStatus("off");
        }
      } catch {
        if (active) setStatus(Notification.permission === "denied" ? "denied" : "off");
      }
    }
    checkStatus();
    return () => { active = false; };
  }, [userId]);

  async function enableNotifications() {
    if (busy) return;
    if (!supportsPush()) {
      setStatus("unsupported");
      return;
    }

    setBusy(true);
    try {
      const keyResponse = await api.pushPublicKey();
      if (!keyResponse.publicKey) throw new Error("Push notifications are not configured on the server yet.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        if (permission === "denied") {
          showToast("Notifications are blocked for this site. Allow them in your browser settings.", "error");
        }
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey)
        });
      }

      await api.savePushSubscription(subscription.toJSON());
      setStatus("enabled");
      showToast("Push notifications enabled");
    } catch (error) {
      showToast(error.message || "Could not enable push notifications", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = registration && await registration.pushManager.getSubscription();
      if (subscription) {
        await api.removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus(Notification.permission === "denied" ? "denied" : "off");
      showToast("Push notifications turned off");
    } catch (error) {
      showToast(error.message || "Could not turn off push notifications", "error");
    } finally {
      setBusy(false);
    }
  }

  const heading = status === "enabled" ? "Push notifications are on" : "Stay updated with push notifications";
  const description = status === "enabled"
    ? "You'll get alerts for expenses you're included in and UPI payment updates."
    : status === "denied"
      ? "Notifications are blocked in this browser. Allow them for this site in your browser settings to enable alerts."
      : status === "unsupported"
        ? "This browser does not support web push notifications. Try a recent browser with web push support."
        : "Get alerts when someone adds an expense involving you or updates a UPI payment—even when SplitShare isn't open.";

  return (
    <section className="upi-setup-card push-notification-card" aria-label="Push notification settings">
      <div className="upi-setup-icon" aria-hidden="true">🔔</div>
      <div className="upi-setup-content">
        <h3>{heading}</h3>
        <p className="small muted">{description}</p>
        {status === "checking" && <p className="small muted">Checking notification support…</p>}
        <div className="upi-setup-actions">
          {status === "enabled" ? (
            <LoadingButton className="btn-secondary invite-secondary-button" onClick={disableNotifications} loading={busy} disabled={busy}>
              {busy ? "Turning off…" : "Turn off notifications"}
            </LoadingButton>
          ) : (
            <LoadingButton className="btn-primary" onClick={enableNotifications} loading={busy} disabled={busy || status === "checking" || status === "unsupported" || status === "denied"}>
              {busy ? "Enabling…" : "Enable push notifications"}
            </LoadingButton>
          )}
        </div>
      </div>
    </section>
  );
}
