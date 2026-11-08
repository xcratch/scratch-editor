/**
 * Offline cache of the preloaded extensions for the PWA.
 *
 * The preload files are placed after building the editor, so they are not in the precache of the service worker.
 * The page stores the manifest and all the files listed in it into the cache `xcratch-preload`, and the service
 * worker (src/service-worker.js) serves the URLs in the cache network-first. This works for a manifest on any host.
 */

import log from './log.js';

/** Name of the cache shared with the service worker. */
export const PRELOAD_CACHE_NAME = 'xcratch-preload';

/** Message types between the page and the service worker. */
export const PRELOAD_MESSAGE = {
    /** page -> SW: the cache was updated, reload the URL list. */
    UPDATED: 'xcratch-preload:updated',
    /** page -> SW (with a MessagePort): reply when the URL list is ready. */
    PING: 'xcratch-preload:ping',
    /** SW -> page: the URL list is ready. */
    PONG: 'xcratch-preload:pong'
};

/**
 * Key of the metadata in the cache. It records the manifests and their files to update and prune the cache.
 * It is never requested by the editor, so the service worker never serves it.
 */
export const PRELOAD_META_KEY = 'https://xcratch-preload.invalid/meta.json';

/** Drop a manifest from the cache when it has not been used for this period [ms]. */
const MANIFEST_EXPIRATION = 90 * 24 * 60 * 60 * 1000;

const CONCURRENCY = 4;

const getServiceWorker = () => ((typeof navigator !== 'undefined' && navigator.serviceWorker) ?
    navigator.serviceWorker : null);

const hasCacheStorage = () => typeof caches !== 'undefined';

/**
 * Wait for a promise with timeout.
 * @param {Promise} promise - promise to wait for
 * @param {number} timeout - timeout [ms]
 * @returns {Promise} resolves with the value or undefined on timeout
 */
const waitAtMost = (promise, timeout) => {
    let timeoutId;
    return Promise.race([
        promise,
        new Promise(resolve => {
            timeoutId = setTimeout(resolve, timeout);
        })
    ]).finally(() => clearTimeout(timeoutId));
};

/**
 * Wait until the service worker which controls this page knows the cached preload URLs.
 * Without this, a request of the manifest just after the start may not be served from the cache when offline.
 * @param {number} [timeout] - timeout [ms]
 * @returns {Promise} resolves when ready, on timeout, or immediately without a controlling service worker.
 */
export const waitForPreloadServiceWorker = (timeout = 1000) => {
    const sw = getServiceWorker();
    if (!sw || !sw.controller || typeof MessageChannel === 'undefined') return Promise.resolve();
    return waitAtMost(new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = event => {
            if (event.data && event.data.type === PRELOAD_MESSAGE.PONG) resolve();
        };
        sw.controller.postMessage({type: PRELOAD_MESSAGE.PING}, [channel.port2]);
    }), timeout);
};

/**
 * Read the metadata from the cache.
 * @param {Cache} cache - preload cache
 * @returns {Promise<{manifests: object}>} metadata
 */
const readMeta = async cache => {
    try {
        const response = await cache.match(PRELOAD_META_KEY);
        if (response) {
            const meta = await response.json();
            if (meta && typeof meta.manifests === 'object' && meta.manifests) return meta;
        }
    } catch (error) {
        log.warn(`Preload cache: invalid metadata: ${error}`);
    }
    return {manifests: {}};
};

/**
 * Run tasks with limited concurrency.
 * @param {Array} items - items
 * @param {Function} task - async function for an item
 * @returns {Promise} resolves when all done
 */
const runLimited = async (items, task) => {
    const queue = items.slice();
    const worker = async () => {
        while (queue.length > 0) {
            await task(queue.shift());
        }
    };
    await Promise.all(Array.from({length: Math.min(CONCURRENCY, items.length)}, worker));
};

/**
 * Store the manifest and all the files in it into the preload cache, and prune the files no manifest uses.
 * @param {import('./preload-manifest.js').PreloadManifest} manifest - manifest
 * @param {string} text - source text of the manifest
 * @param {object} [options] - options
 * @param {CacheStorage} [options.cacheStorage] - cache storage (for tests)
 * @param {Function} [options.fetchFn] - fetch function (for tests)
 * @param {number} [options.now] - current time (for tests)
 * @returns {Promise<{added: number, failed: number, removed: number}>} result
 */
export const updatePreloadCache = async (manifest, text, {
    cacheStorage = caches,
    fetchFn = (...args) => fetch(...args),
    now = Date.now()
} = {}) => {
    const cache = await cacheStorage.open(PRELOAD_CACHE_NAME);
    const meta = await readMeta(cache);
    const previous = meta.manifests[manifest.url];
    const changed = !previous || previous.text !== text;

    // Store the manifest from the text which was read, to be served when offline.
    await cache.put(manifest.url, new Response(text, {headers: {'Content-Type': 'application/json'}}));

    let added = 0;
    let failed = 0;
    await runLimited(manifest.files, async fileURL => {
        try {
            if (!changed && await cache.match(fileURL, {ignoreVary: true})) return;
            // Re-fetch all the files when the manifest changed, since a mirror may be replaced in place.
            const response = await fetchFn(fileURL, {mode: 'cors', cache: changed ? 'reload' : 'default'});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await cache.put(fileURL, response);
            added++;
        } catch (error) {
            failed++;
            log.warn(`Preload cache: failed to store ${fileURL}: ${error}`);
        }
    });

    // Update the metadata and drop expired manifests.
    meta.manifests[manifest.url] = {text, files: manifest.files, usedAt: now};
    Object.keys(meta.manifests).forEach(url => {
        if (url !== manifest.url && now - (meta.manifests[url].usedAt || 0) > MANIFEST_EXPIRATION) {
            delete meta.manifests[url];
        }
    });
    await cache.put(PRELOAD_META_KEY, new Response(JSON.stringify(meta),
        {headers: {'Content-Type': 'application/json'}}));

    // Remove what no manifest uses.
    const inUse = new Set([PRELOAD_META_KEY]);
    Object.keys(meta.manifests).forEach(url => {
        inUse.add(url);
        (meta.manifests[url].files || []).forEach(file => inUse.add(file));
    });
    let removed = 0;
    const requests = await cache.keys();
    await Promise.all(requests.map(async request => {
        if (!inUse.has(request.url)) {
            await cache.delete(request);
            removed++;
        }
    }));
    return {added, failed, removed};
};

/**
 * Make the preloaded extensions available offline when the editor runs with a service worker (installed PWA).
 * It runs in the background and never rejects.
 * @param {import('./preload-manifest.js').PreloadManifest} manifest - manifest
 * @param {string} text - source text of the manifest
 * @param {object} [options] - options
 * @param {number} [options.readyTimeout] - time to wait for a service worker [ms]
 * @returns {Promise} resolves when done
 */
export const syncPreloadCache = async (manifest, text, {readyTimeout = 30000} = {}) => {
    try {
        const sw = getServiceWorker();
        if (!sw || !hasCacheStorage()) return;
        // Skip without a service worker, e.g. on the development server, where nothing serves the cache.
        const registration = await waitAtMost(sw.ready, readyTimeout);
        if (!registration) return;
        const result = await updatePreloadCache(manifest, text);
        log.info(`Preload cache updated: ${manifest.url}`, result);
        // Notify the active worker even if it does not control this page yet (first visit).
        if (registration.active) {
            registration.active.postMessage({type: PRELOAD_MESSAGE.UPDATED});
        }
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(() => {});
        }
    } catch (error) {
        log.warn(`Preload cache: ${error}`);
    }
};
