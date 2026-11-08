/**
 * @jest-environment node
 */
import {
    PRELOAD_CACHE_NAME,
    PRELOAD_META_KEY,
    updatePreloadCache
} from '../../../src/lib/preload-cache';

/** Minimal in-memory CacheStorage. */
class FakeCache {
    constructor () {
        this.entries = new Map();
    }
    match (request) {
        const url = typeof request === 'string' ? request : request.url;
        const entry = this.entries.get(url);
        return Promise.resolve(entry ? entry.clone() : null);
    }
    put (request, response) {
        const url = typeof request === 'string' ? request : request.url;
        this.entries.set(url, response.clone());
        return Promise.resolve();
    }
    keys () {
        return Promise.resolve(Array.from(this.entries.keys()).map(url => ({url})));
    }
    delete (request) {
        return Promise.resolve(this.entries.delete(request.url));
    }
}

class FakeCacheStorage {
    constructor () {
        this.caches = new Map();
    }
    open (name) {
        if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
        return Promise.resolve(this.caches.get(name));
    }
}

const MANIFEST_URL = 'https://edu.example.com/editor/preload/preload.json';
const fileURL = name => `https://edu.example.com/editor/preload/files/${name}`;

const makeManifest = names => ({
    url: MANIFEST_URL,
    name: 'test',
    files: names.map(fileURL),
    extensions: []
});

const setup = () => {
    const cacheStorage = new FakeCacheStorage();
    const fetched = [];
    const fetchFn = jest.fn((url, options) => {
        fetched.push({url, cache: options.cache});
        if (url.includes('missing')) return Promise.resolve(new Response('', {status: 404}));
        return Promise.resolve(new Response(`content of ${url}`));
    });
    return {cacheStorage, fetchFn, fetched};
};

const cachedURLs = async cacheStorage => {
    const cache = await cacheStorage.open(PRELOAD_CACHE_NAME);
    return Array.from(cache.entries.keys()).sort();
};

describe('updatePreloadCache', () => {
    test('stores the manifest and all the files', async () => {
        const {cacheStorage, fetchFn} = setup();
        const manifest = makeManifest(['a.mjs', 'b.mjs']);
        const result = await updatePreloadCache(manifest, 'v1', {cacheStorage, fetchFn});
        expect(result).toEqual({added: 2, failed: 0, removed: 0});
        expect(await cachedURLs(cacheStorage)).toEqual([
            PRELOAD_META_KEY, fileURL('a.mjs'), fileURL('b.mjs'), MANIFEST_URL
        ].sort());
        const cache = await cacheStorage.open(PRELOAD_CACHE_NAME);
        expect(await (await cache.match(MANIFEST_URL)).text()).toBe('v1');
    });

    test('fetches only missing files when the manifest is unchanged', async () => {
        const {cacheStorage, fetchFn, fetched} = setup();
        const manifest = makeManifest(['a.mjs', 'b.mjs']);
        await updatePreloadCache(manifest, 'v1', {cacheStorage, fetchFn});
        const cache = await cacheStorage.open(PRELOAD_CACHE_NAME);
        await cache.delete({url: fileURL('b.mjs')});
        fetched.length = 0;
        const result = await updatePreloadCache(manifest, 'v1', {cacheStorage, fetchFn});
        expect(fetched).toEqual([{url: fileURL('b.mjs'), cache: 'default'}]);
        expect(result.added).toBe(1);
    });

    test('re-fetches all the files and prunes unused ones when the manifest changed', async () => {
        const {cacheStorage, fetchFn, fetched} = setup();
        await updatePreloadCache(makeManifest(['a.mjs', 'b.mjs']), 'v1', {cacheStorage, fetchFn});
        fetched.length = 0;
        const result = await updatePreloadCache(makeManifest(['a.mjs', 'c.mjs']), 'v2', {cacheStorage, fetchFn});
        expect(fetched).toEqual([
            {url: fileURL('a.mjs'), cache: 'reload'},
            {url: fileURL('c.mjs'), cache: 'reload'}
        ]);
        expect(result.removed).toBe(1);
        expect(await cachedURLs(cacheStorage)).toEqual([
            PRELOAD_META_KEY, fileURL('a.mjs'), fileURL('c.mjs'), MANIFEST_URL
        ].sort());
    });

    test('keeps the files of another manifest', async () => {
        const {cacheStorage, fetchFn} = setup();
        await updatePreloadCache(makeManifest(['a.mjs']), 'v1', {cacheStorage, fetchFn});
        const other = {
            url: 'https://ws.example.com/sessions/1/preload.json',
            files: ['https://ws.example.com/sessions/1/files/x.mjs'],
            extensions: []
        };
        await updatePreloadCache(other, 'other', {cacheStorage, fetchFn});
        expect(await cachedURLs(cacheStorage)).toEqual([
            PRELOAD_META_KEY, fileURL('a.mjs'), MANIFEST_URL, other.url, other.files[0]
        ].sort());
    });

    test('drops a manifest which has not been used for a long time', async () => {
        const {cacheStorage, fetchFn} = setup();
        const day = 24 * 60 * 60 * 1000;
        await updatePreloadCache(makeManifest(['a.mjs']), 'v1', {cacheStorage, fetchFn, now: 0});
        const other = {
            url: 'https://ws.example.com/sessions/1/preload.json',
            files: ['https://ws.example.com/sessions/1/files/x.mjs'],
            extensions: []
        };
        await updatePreloadCache(other, 'other', {cacheStorage, fetchFn, now: 365 * day});
        expect(await cachedURLs(cacheStorage)).toEqual([PRELOAD_META_KEY, other.url, other.files[0]].sort());
    });

    test('counts a file which failed to be fetched', async () => {
        const {cacheStorage, fetchFn} = setup();
        const result = await updatePreloadCache(makeManifest(['a.mjs', 'missing.mjs']), 'v1',
            {cacheStorage, fetchFn});
        expect(result).toEqual({added: 1, failed: 1, removed: 0});
    });
});
