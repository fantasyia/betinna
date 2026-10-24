/* global self */
/* Web Push do Betinna (24/10) — importado pelo service worker do PWA
 * (workbox.importScripts). Mostra a notificação e, ao tocar, abre a tela certa. */
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { titulo: 'Betinna', corpo: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.titulo || 'Betinna', {
      body: d.corpo || '',
      icon: '/betinna-symbol.png',
      badge: '/betinna-symbol.png',
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abas) => {
      for (const aba of abas) {
        if ('focus' in aba) {
          aba.navigate(url);
          return aba.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
