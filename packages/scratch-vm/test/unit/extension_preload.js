const tap = require('tap');
const VirtualMachine = require('../../src/virtual-machine');

const test = tap.test;

const ORIGINAL_URL = 'https://example.github.io/xcx-foo/dist/foo.mjs';
const ENTRY_ONLY_URL = 'https://example.github.io/xcx-bar/dist/bar-entry.mjs';
const BLOCK_CLASS_URL = 'https://example.github.io/xcx-bar/dist/bar.mjs';

const toDataURL = source => `data:text/javascript,${encodeURIComponent(source)}`;

const blockClassSource = id => `
export class blockClass {
    constructor (runtime) { this.runtime = runtime; }
    getInfo () { return {id: '${id}', name: '${id}', blocks: []}; }
}`;

// Integrated module: exports both entry and blockClass.
const integratedMirrorURL = toDataURL(`
export const entry = {extensionId: 'foo', name: 'Foo', extensionURL: '${ORIGINAL_URL}'};
${blockClassSource('foo')}`);

// Entry-only module and the module of its blockClass.
const entryOnlyMirrorURL = toDataURL(`
export const entry = {extensionId: 'bar', name: 'Bar', extensionURL: '${BLOCK_CLASS_URL}'};`);
const blockClassMirrorURL = toDataURL(blockClassSource('bar'));

const records = () => ([
    {
        url: ORIGINAL_URL,
        extensionURL: ORIGINAL_URL,
        entryURL: integratedMirrorURL,
        moduleURL: integratedMirrorURL,
        originTimeout: 100
    },
    {
        url: ENTRY_ONLY_URL,
        extensionURL: BLOCK_CLASS_URL,
        entryURL: entryOnlyMirrorURL,
        moduleURL: blockClassMirrorURL
    }
]);

/**
 * Create an extension manager whose network access is stubbed.
 * @param {object} options - options
 * @param {Function} [options.original] - handles fetchExtension() for a non data: URL
 * @returns {{manager: ExtensionManager, registered: Array, turboWarp: Array}} manager and call logs
 */
const setup = ({original} = {}) => {
    const vm = new VirtualMachine();
    const manager = vm.extensionManager;
    const registered = [];
    const turboWarp = [];
    const fetchExtension = manager.fetchExtension.bind(manager);
    manager.fetchExtension = url => {
        if (url.startsWith('data:')) return fetchExtension(url);
        return original ? original(url) : Promise.reject(new Error(`blocked: ${url}`));
    };
    manager.fetchExtensionTurboWarp = url => {
        turboWarp.push(url);
        return Promise.reject(new Error(`not TurboWarp: ${url}`));
    };
    manager.registerExtensionBlock = (entry, blockClass) => {
        registered.push({entry, blockClass});
    };
    return {manager, registered, turboWarp};
};

test('findPreloadedExtension finds by url, extensionURL and aliases', async t => {
    const {manager} = setup();
    await manager.setPreloadManifest([...records(), {
        url: 'https://example.com/a.mjs',
        extensionURL: 'https://example.com/a.mjs',
        entryURL: 'x',
        moduleURL: 'x',
        aliases: ['https://old.example.com/a.mjs']
    }]);
    t.equal(manager.findPreloadedExtension(ORIGINAL_URL).url, ORIGINAL_URL);
    t.equal(manager.findPreloadedExtension(ENTRY_ONLY_URL).url, ENTRY_ONLY_URL);
    t.equal(manager.findPreloadedExtension(BLOCK_CLASS_URL).url, ENTRY_ONLY_URL);
    t.equal(manager.findPreloadedExtension('https://old.example.com/a.mjs').url, 'https://example.com/a.mjs');
    t.equal(manager.findPreloadedExtension('https://example.com/unknown.mjs'), null);
});

test('loads from the original URL first', async t => {
    const originalEntry = {extensionId: 'foo', extensionURL: ORIGINAL_URL};
    const originalBlockClass = function () {};
    const {manager, registered} = setup({
        original: () => Promise.resolve({entry: originalEntry, blockClass: originalBlockClass})
    });
    manager.setPreloadManifest(records());
    await manager.loadExtensionURL(ORIGINAL_URL);
    t.equal(registered.length, 1);
    t.equal(registered[0].entry, originalEntry);
    t.equal(registered[0].blockClass, originalBlockClass);
});

test('falls back to the mirror and keeps the original URL', async t => {
    const {manager, registered, turboWarp} = setup();
    manager.setPreloadManifest(records());
    await manager.loadExtensionURL(ORIGINAL_URL);
    t.equal(registered.length, 1);
    t.equal(registered[0].entry.extensionId, 'foo');
    t.equal(registered[0].entry.extensionURL, ORIGINAL_URL);
    t.equal(registered[0].blockClass.extensionURL, ORIGINAL_URL);
    t.same(turboWarp, [], 'does not try TurboWarp format for a preloaded extension');
});

test('falls back to the mirror of an entry-only extension', async t => {
    const {manager, registered} = setup();
    manager.setPreloadManifest(records());
    // A project saves the URL of the blockClass module.
    await manager.loadExtensionURL(BLOCK_CLASS_URL);
    t.equal(registered.length, 1);
    t.equal(registered[0].entry.extensionId, 'bar');
    t.equal(registered[0].entry.extensionURL, BLOCK_CLASS_URL);
    t.equal(registered[0].blockClass.extensionURL, BLOCK_CLASS_URL);
    t.equal(new registered[0].blockClass().getInfo().id, 'bar');
});

test('uses the mirror when the original URL does not settle within originTimeout', async t => {
    const {manager, registered} = setup({
        original: () => new Promise(() => {}) // never settles
    });
    manager.setPreloadManifest(records());
    const start = Date.now();
    await manager.loadExtensionURL(ORIGINAL_URL);
    t.ok(Date.now() - start < 5000, 'does not wait the default timeout');
    t.equal(registered.length, 1);
    t.equal(registered[0].entry.extensionURL, ORIGINAL_URL);
});

test('waits for the preload manifest before loading', async t => {
    const {manager, registered} = setup();
    let resolveManifest;
    manager.setPreloadManifest(new Promise(resolve => {
        resolveManifest = resolve;
    }));
    const loading = manager.loadExtensionURL(ORIGINAL_URL);
    setTimeout(() => resolveManifest(records()), 50);
    await loading;
    t.equal(registered.length, 1, 'the mirror is found after the manifest is set');
});

test('a failed manifest does not block loading', async t => {
    const {manager, registered, turboWarp} = setup();
    manager.setPreloadManifest(Promise.reject(new Error('no manifest')));
    await manager.loadExtensionURL(ORIGINAL_URL);
    t.equal(registered.length, 0);
    t.same(turboWarp, [ORIGINAL_URL], 'loads as a non-preloaded extension');
});

test('an extension which is not preloaded tries TurboWarp format', async t => {
    const {manager, registered, turboWarp} = setup();
    manager.setPreloadManifest(records());
    const url = 'https://example.com/other.js';
    await manager.loadExtensionURL(url);
    t.equal(registered.length, 0);
    t.same(turboWarp, [url]);
});
