// Anna's service worker: shows the nightly notification and opens the edit when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Anna', {
    body: data.body || 'Today’s Anna edition is here.',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: 'anna-edit',
    data: { url: data.url || '/?open=edit' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { w.postMessage({ type: 'open-edit' }); return w.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
