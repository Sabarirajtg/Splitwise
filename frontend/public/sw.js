self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(self.registration.showNotification(payload.title || "SplitShare", {
    body: payload.body || "There's an update in one of your groups.",
    data: { url: payload.url || "/groups" },
    tag: payload.tag || undefined,
    renotify: false
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const requestedUrl = new URL((event.notification.data && event.notification.data.url) || "/groups", self.location.origin);
    const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : new URL("/groups", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        if (client.url !== targetUrl && "navigate" in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
