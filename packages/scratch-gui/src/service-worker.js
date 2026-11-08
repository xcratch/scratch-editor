/**
 * Service worker of the Xcratch editor (built by workbox-webpack-plugin InjectManifest).
 *
 * - precache: the editor assets listed at build time
 * - navigation: network-first with the cache as fallback
 * - preloaded extensions: the manifest and the mirrors which the page stored into the cache `xcratch-preload`
 *   (src/lib/preload-cache.js) are served network-first, so that they are available offline.
 */

import {clientsClaim} from 'workbox-core';
import {precacheAndRoute} from 'workbox-precaching';
import {registerRoute} from 'workbox-routing';
import {NetworkFirst} from 'workbox-strategies';

// Keep in sync with src/lib/preload-cache.js
const PRELOAD_CACHE_NAME = 'xcratch-preload';
const PRELOAD_MESSAGE = {
    UPDATED: 'xcratch-preload:updated',
    PING: 'xcratch-preload:ping',
    PONG: 'xcratch-preload:pong'
};

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

/**
 * URLs in the preload cache. The route is chosen synchronously, so the URLs are kept in memory.
 * The manifest may be on any host, so the URLs can not be matched by a pattern.
 * @type {Set<string>}
 */
let preloadURLs = new Set();

const loadPreloadURLs = () => caches.open(PRELOAD_CACHE_NAME)
    .then(cache => cache.keys())
    .then(requests => {
        preloadURLs = new Set(requests.map(request => request.url));
    })
    .catch(() => {});

let preloadURLsReady = loadPreloadURLs();

self.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === PRELOAD_MESSAGE.UPDATED) {
        preloadURLsReady = loadPreloadURLs();
        event.waitUntil(preloadURLsReady);
    } else if (data.type === PRELOAD_MESSAGE.PING) {
        const port = event.ports && event.ports[0];
        event.waitUntil(preloadURLsReady.then(() => {
            if (port) port.postMessage({type: PRELOAD_MESSAGE.PONG});
        }));
    }
});

registerRoute(
    ({request, url}) => request.method === 'GET' && request.mode !== 'navigate' && preloadURLs.has(url.href),
    new NetworkFirst({
        cacheName: PRELOAD_CACHE_NAME,
        networkTimeoutSeconds: 5,
        matchOptions: {ignoreVary: true}
    })
);

// Apply NetworkFirst strategy to HTML and navigation requests (e.g. /editor/, /editor/?extension=...)
// Online: always fetch the latest from the network; Offline: fall back to cache
registerRoute(
    ({request}) => request.mode === 'navigate',
    new NetworkFirst({
        cacheName: 'pages-cache',
        networkTimeoutSeconds: 3,
        fetchOptions: {
            cache: 'reload'
        }
    })
);
