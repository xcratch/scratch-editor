/**
 * Preload manifest: the set of preloaded extensions, which is read at run time.
 *
 * The manifest and the mirrors of the extensions are static files written by `scripts/preload-mirror.mjs`,
 * so the set can be changed after building the editor. See `docs/PRELOAD.md` in xcratch/scratch-editor.
 */

import log from './log.js';

/** Version of the manifest format which this editor can read. */
export const PRELOAD_MANIFEST_VERSION = 1;

/** Path of the default manifest, relative to the page. */
export const DEFAULT_PRELOAD_MANIFEST_PATH = 'preload/preload.json';

/** URL query parameter to choose the manifest. */
export const PRELOAD_PARAM = 'preload';

/** Value of the parameter to disable preloading. */
export const PRELOAD_NONE = 'none';

const DEFAULT_FETCH_TIMEOUT = 10000; // [ms]

/**
 * @typedef {object} PreloadRecord
 * @property {string} url - URL of the extension module listed in the preload rules.
 * @property {string} extensionURL - URL of the module which contains the blockClass (saved in projects).
 * @property {string} entryURL - absolute URL of the mirror of `url`.
 * @property {string} moduleURL - absolute URL of the mirror of `extensionURL`.
 * @property {number} [originTimeout] - timeout for loading from the original URL [ms].
 * @property {Array<string>} [aliases] - other URLs which refer the extension.
 */

/**
 * @typedef {object} PreloadManifest
 * @property {string} url - absolute URL of the manifest.
 * @property {string} name - name of the set.
 * @property {Array<string>} files - absolute URLs of all the mirrored files.
 * @property {Array<PreloadRecord>} extensions - preloaded extensions.
 */

/**
 * Decide the URL of the manifest from the page URL.
 * - no parameter: `./preload/preload.json` relative to the page
 * - `?preload=<URL>`: the URL (relative to the page)
 * - `?preload=none`: no manifest
 * @param {string} [pageURL] - URL of the page (default: current location).
 * @returns {?string} absolute URL of the manifest, or null when preloading is disabled.
 */
export const getPreloadManifestURL = (pageURL = window.location.href) => {
    const page = new URL(pageURL);
    const param = page.searchParams.get(PRELOAD_PARAM);
    if (param !== null && param.trim() === PRELOAD_NONE) return null;
    const target = (param !== null && param.trim()) ? param.trim() : DEFAULT_PRELOAD_MANIFEST_PATH;
    try {
        return new URL(target, page).href;
    } catch (error) {
        log.warn(`Invalid preload manifest URL: ${target}`);
        return null;
    }
};

/**
 * Resolve a URL in the manifest against the manifest URL.
 * @param {*} value - URL or path in the manifest.
 * @param {string} manifestURL - absolute URL of the manifest.
 * @returns {?string} absolute URL, or null if it is not a valid string.
 */
const resolveURL = (value, manifestURL) => {
    if (typeof value !== 'string' || !value) return null;
    try {
        return new URL(value, manifestURL).href;
    } catch (error) {
        return null;
    }
};

/**
 * Validate the manifest and resolve the URLs in it.
 * @param {object} json - parsed manifest.
 * @param {string} manifestURL - absolute URL of the manifest.
 * @returns {PreloadManifest} manifest with absolute URLs.
 * @throws {Error} if the manifest is invalid.
 */
export const parsePreloadManifest = (json, manifestURL) => {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('The manifest is not an object');
    }
    if (json.version !== PRELOAD_MANIFEST_VERSION) {
        throw new Error(`Unsupported manifest version: ${json.version}`);
    }
    if (!Array.isArray(json.extensions)) {
        throw new Error('"extensions" is not an array');
    }
    const defaultOriginTimeout = (typeof json.originTimeout === 'number' && json.originTimeout > 0) ?
        json.originTimeout : null;
    const extensions = [];
    json.extensions.forEach((ext, index) => {
        if (!ext || typeof ext !== 'object') {
            log.warn(`Preload manifest: invalid extension at ${index}`);
            return;
        }
        const url = resolveURL(ext.url, manifestURL);
        const extensionURL = resolveURL(ext.extensionURL, manifestURL) || url;
        const entryURL = resolveURL(ext.entry, manifestURL) || resolveURL(ext.module, manifestURL);
        const moduleURL = resolveURL(ext.module, manifestURL) || entryURL;
        if (!url || !entryURL) {
            log.warn(`Preload manifest: "url" and "entry" are required for the extension at ${index}`);
            return;
        }
        const record = {url, extensionURL, entryURL, moduleURL};
        const originTimeout = (typeof ext.originTimeout === 'number' && ext.originTimeout > 0) ?
            ext.originTimeout : defaultOriginTimeout;
        if (originTimeout) record.originTimeout = originTimeout;
        if (Array.isArray(ext.aliases)) {
            record.aliases = ext.aliases
                .map(alias => resolveURL(alias, manifestURL))
                .filter(alias => alias);
        }
        extensions.push(record);
    });
    const files = new Set();
    if (Array.isArray(json.files)) {
        json.files.forEach(file => {
            const fileURL = resolveURL(file, manifestURL);
            if (fileURL) files.add(fileURL);
        });
    }
    // The mirrors must be cached for offline use even if "files" misses them.
    extensions.forEach(({entryURL, moduleURL}) => {
        files.add(entryURL);
        files.add(moduleURL);
    });
    return {
        url: manifestURL,
        name: typeof json.name === 'string' ? json.name : '',
        files: Array.from(files),
        extensions
    };
};

/**
 * Fetch and parse the manifest.
 * @param {string} manifestURL - absolute URL of the manifest.
 * @param {object} [options] - options
 * @param {number} [options.timeout] - timeout [ms]
 * @param {Function} [options.fetchFn] - fetch function (for tests)
 * @returns {Promise<?{manifest: PreloadManifest, text: string}>} the manifest and its source text,
 * or null when there is no valid manifest (never rejects).
 */
export const fetchPreloadManifest = async (manifestURL, {
    timeout = DEFAULT_FETCH_TIMEOUT,
    fetchFn = (...args) => fetch(...args)
} = {}) => {
    let timeoutId;
    try {
        const controller = typeof AbortController === 'undefined' ? null : new AbortController();
        timeoutId = setTimeout(() => controller && controller.abort(), timeout);
        const response = await fetchFn(manifestURL, controller ? {signal: controller.signal} : {});
        if (!response.ok) {
            if (response.status === 404) {
                log.info(`No preload manifest: ${manifestURL}`);
            } else {
                log.warn(`Failed to fetch preload manifest: ${manifestURL}: ${response.status}`);
            }
            return null;
        }
        const text = await response.text();
        const manifest = parsePreloadManifest(JSON.parse(text), manifestURL);
        return {manifest, text};
    } catch (error) {
        log.warn(`Failed to read preload manifest: ${manifestURL}: ${error}`);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
};
