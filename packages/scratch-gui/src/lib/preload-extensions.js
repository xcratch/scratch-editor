/**
 * Start preloading extensions listed in the preload manifest.
 *
 * - The VM gets the list right away, so that it can fall back to the mirror when the original URL of an extension
 *   in a project cannot be loaded (e.g. github.io is blocked by a filter).
 * - The entries are added to the extension library in the "preloaded" category.
 * - With a service worker (installed PWA), the files are cached for offline use.
 */

import log from './log.js';
import extensionLibraryContent from './libraries/extensions/index.jsx';
import {fetchPreloadManifest, getPreloadManifestURL} from './preload-manifest.js';
import {syncPreloadCache, waitForPreloadServiceWorker} from './preload-cache.js';

/** Timeout for importing an entry module [ms]. A module may never settle when its import is blocked. */
const ENTRY_IMPORT_TIMEOUT = 30000;

/**
 * Reject when the promise does not settle within the timeout.
 * @param {Promise} promise - promise to wait for
 * @param {number} timeout - timeout [ms]
 * @param {string} label - label for the error message
 * @returns {Promise} promise which settles with the given one or rejects on timeout
 */
const withTimeout = (promise, timeout, label) => {
    let timeoutId;
    const timer = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timed out after ${timeout} ms: ${label}`)), timeout);
    });
    return Promise.race([promise, timer])
        .finally(() => clearTimeout(timeoutId));
};

const nameOf = entry => {
    if (!entry.name) return '';
    if (typeof entry.name === 'string') return entry.name;
    if (entry.name.defaultMessage) return entry.name.defaultMessage;
    if (entry.name.props && entry.name.props.defaultMessage) return entry.name.props.defaultMessage;
    return String(entry.extensionId || '');
};

/**
 * Import the entries of the preloaded extensions and add them to the extension library.
 * @param {Array<import('./preload-manifest.js').PreloadRecord>} records - preloaded extensions
 * @param {Function} [importFn] - dynamic import (for tests)
 * @returns {Promise<Array<object>>} entries added to the library
 */
export const addPreloadedEntries = async (
    records,
    importFn = url => import(/* webpackIgnore: true */ url)
) => {
    const entries = await Promise.all(records.map(async record => {
        try {
            const module = await withTimeout(importFn(record.entryURL), ENTRY_IMPORT_TIMEOUT, record.entryURL);
            if (!module || !module.entry) {
                throw new Error('entry not found');
            }
            return {entry: module.entry, record};
        } catch (error) {
            log.warn(`Failed to load preloaded extension ${record.url}: ${error}`);
            return null;
        }
    }));
    const added = [];
    entries
        .filter(item => item)
        .sort((a, b) => nameOf(a.entry).localeCompare(nameOf(b.entry)))
        .forEach(({entry, record}) => {
            const exists = extensionLibraryContent.some(item =>
                item.extensionId === entry.extensionId ||
                (item.extensionURL && (item.extensionURL === record.extensionURL || item.extensionURL === record.url))
            );
            if (exists) return;
            entry.category = 'preloaded';
            // The library card and the saved project refer to the original URL of the blockClass module.
            entry.extensionURL = record.extensionURL;
            extensionLibraryContent.push(entry);
            added.push(entry);
        });
    return added;
};

/**
 * Start preloading extensions for the VM. Call once before loading a project.
 * @param {VirtualMachine} vm - the VM
 * @param {object} [options] - options
 * @param {string} [options.pageURL] - URL of the page (default: current location)
 * @returns {Promise<?import('./preload-manifest.js').PreloadManifest>} the manifest, or null if none
 */
export const startPreloadExtensions = (vm, {pageURL} = {}) => {
    if (vm.preloadExtensionsPromise) return vm.preloadExtensionsPromise;
    const manifestURL = getPreloadManifestURL(pageURL);
    const loading = manifestURL ?
        waitForPreloadServiceWorker().then(() => fetchPreloadManifest(manifestURL)) :
        Promise.resolve(null);
    // Set the promise synchronously, so that the extensions in a project wait for the manifest.
    vm.extensionManager.setPreloadManifest(loading.then(result => (result ? result.manifest.extensions : [])));
    vm.preloadExtensionsPromise = loading.then(async result => {
        if (!result) return null;
        const {manifest, text} = result;
        // Do not wait: caching may take long for large extensions.
        syncPreloadCache(manifest, text);
        const added = await addPreloadedEntries(manifest.extensions);
        log.info(`Extensions preloaded from ${manifest.url}:`, added.map(entry => entry.extensionId));
        return manifest;
    })
        .catch(error => {
            log.warn(`Failed to preload extensions: ${error}`);
            return null;
        });
    return vm.preloadExtensionsPromise;
};
