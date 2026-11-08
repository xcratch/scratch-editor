import {
    fetchPreloadManifest,
    getPreloadManifestURL,
    parsePreloadManifest
} from '../../../src/lib/preload-manifest';

const PAGE = 'https://edu.example.com/editor/index.html';
const MANIFEST = 'https://edu.example.com/editor/preload/preload.json';

describe('getPreloadManifestURL', () => {
    test('uses preload/preload.json relative to the page by default', () => {
        expect(getPreloadManifestURL(PAGE)).toBe(MANIFEST);
        expect(getPreloadManifestURL('https://edu.example.com/editor/?foo=1#123')).toBe(MANIFEST);
    });
    test('uses the default for an empty parameter', () => {
        expect(getPreloadManifestURL(`${PAGE}?preload=`)).toBe(MANIFEST);
    });
    test('resolves a relative parameter against the page', () => {
        expect(getPreloadManifestURL(`${PAGE}?preload=preload/sets/b/preload.json`))
            .toBe('https://edu.example.com/editor/preload/sets/b/preload.json');
        expect(getPreloadManifestURL(`${PAGE}?preload=%2Fworkshop%2Fstore%2Fpreload.json`))
            .toBe('https://edu.example.com/workshop/store/preload.json');
    });
    test('accepts an absolute URL on any host', () => {
        const url = 'https://other.example.org/sets/a/preload.json';
        expect(getPreloadManifestURL(`${PAGE}?preload=${encodeURIComponent(url)}`)).toBe(url);
    });
    test('returns null for none', () => {
        expect(getPreloadManifestURL(`${PAGE}?preload=none`)).toBeNull();
    });
});

describe('parsePreloadManifest', () => {
    const manifest = {
        version: 1,
        name: 'default',
        originTimeout: 5000,
        files: [
            'files/example.github.io/foo/dist/foo.mjs',
            'files/example.github.io/bar/dist/bar-entry.mjs',
            'files/example.github.io/bar/dist/bar.mjs',
            'files/example.github.io/bar/dist/model.bin'
        ],
        extensions: [
            {
                url: 'https://example.github.io/foo/dist/foo.mjs',
                extensionURL: 'https://example.github.io/foo/dist/foo.mjs',
                entry: 'files/example.github.io/foo/dist/foo.mjs',
                module: 'files/example.github.io/foo/dist/foo.mjs'
            },
            {
                url: 'https://example.github.io/bar/dist/bar-entry.mjs',
                extensionURL: 'https://example.github.io/bar/dist/bar.mjs',
                entry: 'files/example.github.io/bar/dist/bar-entry.mjs',
                module: 'https://mirror.example.org/bar.mjs',
                originTimeout: 1000,
                aliases: ['https://old.example.com/bar.mjs']
            }
        ]
    };

    test('resolves the paths against the manifest URL', () => {
        const result = parsePreloadManifest(manifest, MANIFEST);
        expect(result.url).toBe(MANIFEST);
        expect(result.name).toBe('default');
        expect(result.extensions).toEqual([
            {
                url: 'https://example.github.io/foo/dist/foo.mjs',
                extensionURL: 'https://example.github.io/foo/dist/foo.mjs',
                entryURL: 'https://edu.example.com/editor/preload/files/example.github.io/foo/dist/foo.mjs',
                moduleURL: 'https://edu.example.com/editor/preload/files/example.github.io/foo/dist/foo.mjs',
                originTimeout: 5000
            },
            {
                url: 'https://example.github.io/bar/dist/bar-entry.mjs',
                extensionURL: 'https://example.github.io/bar/dist/bar.mjs',
                entryURL: 'https://edu.example.com/editor/preload/files/example.github.io/bar/dist/bar-entry.mjs',
                moduleURL: 'https://mirror.example.org/bar.mjs',
                originTimeout: 1000,
                aliases: ['https://old.example.com/bar.mjs']
            }
        ]);
    });

    test('lists all the files including the mirrors', () => {
        const result = parsePreloadManifest(manifest, MANIFEST);
        expect(result.files).toEqual([
            'https://edu.example.com/editor/preload/files/example.github.io/foo/dist/foo.mjs',
            'https://edu.example.com/editor/preload/files/example.github.io/bar/dist/bar-entry.mjs',
            'https://edu.example.com/editor/preload/files/example.github.io/bar/dist/bar.mjs',
            'https://edu.example.com/editor/preload/files/example.github.io/bar/dist/model.bin',
            'https://mirror.example.org/bar.mjs'
        ]);
    });

    test('fills extensionURL and module from url and entry', () => {
        const result = parsePreloadManifest({
            version: 1,
            extensions: [{url: 'https://example.com/a.mjs', entry: 'a.mjs'}]
        }, MANIFEST);
        expect(result.extensions[0]).toEqual({
            url: 'https://example.com/a.mjs',
            extensionURL: 'https://example.com/a.mjs',
            entryURL: 'https://edu.example.com/editor/preload/a.mjs',
            moduleURL: 'https://edu.example.com/editor/preload/a.mjs'
        });
    });

    test('skips an invalid extension', () => {
        const result = parsePreloadManifest({
            version: 1,
            extensions: [null, {entry: 'a.mjs'}, {url: 'https://example.com/a.mjs', entry: 'a.mjs'}]
        }, MANIFEST);
        expect(result.extensions.map(ext => ext.url)).toEqual(['https://example.com/a.mjs']);
    });

    test('rejects an unsupported manifest', () => {
        expect(() => parsePreloadManifest(null, MANIFEST)).toThrow();
        expect(() => parsePreloadManifest([], MANIFEST)).toThrow();
        expect(() => parsePreloadManifest({version: 2, extensions: []}, MANIFEST)).toThrow();
        expect(() => parsePreloadManifest({version: 1}, MANIFEST)).toThrow();
    });
});

describe('fetchPreloadManifest', () => {
    const response = (status, body) => ({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body)
    });

    test('returns the manifest and its text', async () => {
        const text = JSON.stringify({version: 1, extensions: []});
        const fetchFn = jest.fn(() => Promise.resolve(response(200, text)));
        const result = await fetchPreloadManifest(MANIFEST, {fetchFn});
        expect(fetchFn).toHaveBeenCalledWith(MANIFEST, expect.any(Object));
        expect(result.text).toBe(text);
        expect(result.manifest.url).toBe(MANIFEST);
    });

    test('returns null for 404', async () => {
        const result = await fetchPreloadManifest(MANIFEST, {fetchFn: () => Promise.resolve(response(404, ''))});
        expect(result).toBeNull();
    });

    test('returns null for invalid JSON', async () => {
        const result = await fetchPreloadManifest(MANIFEST, {fetchFn: () => Promise.resolve(response(200, '{'))});
        expect(result).toBeNull();
    });

    test('returns null on a network error', async () => {
        const result = await fetchPreloadManifest(MANIFEST, {fetchFn: () => Promise.reject(new Error('offline'))});
        expect(result).toBeNull();
    });
});
