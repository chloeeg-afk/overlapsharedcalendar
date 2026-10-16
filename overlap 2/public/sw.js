self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "Overlap", {
    body: d.body || "The calendar changed",
    icon: "/icon-192.png",
    badge: "/icon-192.png"
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((l) => {
    for (const c of l) if ("focus" in c) return c.focus();
    return clients.openWindow("/");
  }));
});
