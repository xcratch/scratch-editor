#!/usr/bin/env node
/**
 * Mirror Xcratch extensions into a directory served along with the editor, and write the preload manifest.
 *
 * The editor reads the manifest at run time (`./preload/preload.json` or `?preload=<URL>`), so the set of
 * preloaded extensions can be changed without rebuilding the editor. See `docs/PRELOAD.md` in xcratch/scratch-editor.
 *
 * Usage:
 *   node preload-mirror.mjs --rules <rules.json> --out <dir> [--name <name>] [--origin-timeout <ms>]
 *                           [--fetch-timeout <ms>] [--insecure]
 *
 * This script uses only the Node.js (>= 18) built-ins so that it can be copied and run outside of this repository.
 */

import fs from 'fs';
import path from 'path';
import {parseArgs} from 'util';
import {fileURLToPath} from 'url';

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE_NAME = 'preload.json';
export const FILES_DIR_NAME = 'files';

const DEFAULT_FETCH_TIMEOUT = 30000; // [ms]

/**
 * Check if content is a valid Xcratch extension module (entry or blockClass).
 * @param {string} content - module source
 * @returns {boolean} true if valid
 */
export const isValidExtensionContent = content =>
    !!content && !!content.trim() && (content.includes('entry') || content.includes('blockClass'));

/**
 * Check if the module has only an entry and its blockClass is in another module (entry-only module).
 * @param {string} content - module source
 * @returns {boolean} true if entry-only
 */
export const hasOnlyEntry = content => content.includes('entry') && !content.includes('blockClass');

/**
 * Extract the `extensionURL` declared in an entry-only module.
 * @param {string} content - module source
 * @returns {?string} declared URL
 */
export const extractExtensionURL = content => {
    const match = content.match(/extensionURL\s*:\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
};

/**
 * Check if the specifier is relative to the module (`./` or `../`).
 * @param {string} specifier - module specifier or URL
 * @returns {boolean} true if relative
 */
const isRelativeSpecifier = specifier => /^\.\.?\//.test(specifier);

/**
 * Find specifiers of the modules and resources referred from a module.
 * - static import / export ... from, side-effect import, dynamic import() with a string literal
 * - new URL('<literal>', import.meta.url)
 * - `blockClassURL` of an entry
 * @param {string} content - module source
 * @returns {Array<string>} specifiers (deduplicated)
 */
export const findReferences = content => {
    const patterns = [
        /\b(?:import|export)\b[^'";()]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
        /\bimport\s*['"]([^'"\n]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
        /\bnew\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
        /\bblockClassURL\s*:\s*['"]([^'"\n]+)['"]/g
    ];
    // Drop comments roughly (block comments and whole-line comments) to avoid picking up code in them.
    // A reference which is not found only results in a warning.
    const code = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const found = new Set();
    patterns.forEach(pattern => {
        for (const match of code.matchAll(pattern)) {
            found.add(match[1]);
        }
    });
    return Array.from(found);
};

/**
 * Check if the resource is a JavaScript module which may refer other files.
 * @param {string} url - URL of the resource
 * @param {?string} contentType - Content-Type of the response
 * @returns {boolean} true if it is a script
 */
const isScript = (url, contentType) =>
    /\.(m?js|cjs)$/i.test(new URL(url).pathname) || /javascript|ecmascript/i.test(contentType || '');

/**
 * Get the path in the mirror directory for a URL, relative to the manifest. It keeps the host and the path of the
 * URL so that relative references in a module resolve in the mirror as well.
 * @param {string} url - absolute URL
 * @returns {string} relative URL path, e.g. 'files/example.github.io/xcx-foo/dist/foo.mjs'
 */
export const mirrorPathOf = url => {
    const u = new URL(url);
    let pathname = u.pathname;
    if (pathname.endsWith('/')) pathname += 'index';
    // ':' of a port is not allowed in a file name on some platforms.
    const host = u.host.replace(/:/g, '_');
    return `${FILES_DIR_NAME}/${host}${pathname}`;
};

/**
 * Get the local file path for a mirror path (the URL path is percent-decoded as HTTP servers do).
 * @param {string} outDir - output directory
 * @param {string} mirrorPath - relative URL path from mirrorPathOf()
 * @returns {string} file path
 */
const filePathOf = (outDir, mirrorPath) => {
    const segments = mirrorPath.split('/').map(segment => decodeURIComponent(segment));
    if (segments.some(segment => segment === '..' || segment === '.' || segment.includes(path.sep))) {
        throw new Error(`Unsafe path: ${mirrorPath}`);
    }
    return path.join(outDir, ...segments);
};

/**
 * Fetch with timeout.
 * @param {string} url - URL to fetch
 * @param {number} timeout - timeout [ms]
 * @returns {Promise<Response>} response which is ok
 */
const fetchWithTimeout = async (url, timeout) => {
    const response = await fetch(url, {signal: AbortSignal.timeout(timeout), redirect: 'follow'});
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
    }
    return response;
};

/**
 * Mirror extensions.
 * @param {object} options - options
 * @param {Array<string>} options.urls - URLs of the extension modules
 * @param {string} options.outDir - output directory
 * @param {string} [options.name] - name of the set
 * @param {number} [options.originTimeout] - timeout for loading from the original URL in the editor [ms]
 * @param {number} [options.fetchTimeout] - timeout for each download [ms]
 * @param {object} [options.logger] - logger (console compatible)
 * @returns {Promise<object>} the manifest written
 */
export const mirrorExtensions = async ({
    urls,
    outDir,
    name,
    originTimeout,
    fetchTimeout = DEFAULT_FETCH_TIMEOUT,
    logger = console
}) => {
    // Remove only what this script writes, so that other sets can be placed under the same directory.
    fs.rmSync(path.join(outDir, FILES_DIR_NAME), {recursive: true, force: true});
    fs.mkdirSync(outDir, {recursive: true});

    /** @type {Map<string, Promise<{content: ?string, mirrorPath: string}>>} downloaded URL -> result */
    const downloads = new Map();

    /**
     * Download a resource and the relative references in it recursively.
     * @param {string} url - absolute URL
     * @param {Set<string>} files - collects mirror paths of the extension
     * @returns {Promise<?string>} content if it is a script, otherwise null
     */
    const download = (url, files) => {
        if (!downloads.has(url)) {
            downloads.set(url, (async () => {
                const response = await fetchWithTimeout(url, fetchTimeout);
                const mirrorPath = mirrorPathOf(url);
                const filePath = filePathOf(outDir, mirrorPath);
                const buffer = Buffer.from(await response.arrayBuffer());
                fs.mkdirSync(path.dirname(filePath), {recursive: true});
                fs.writeFileSync(filePath, buffer);
                const script = isScript(url, response.headers.get('content-type'));
                return {content: script ? buffer.toString('utf8') : null, mirrorPath};
            })());
        }
        return downloads.get(url).then(async ({content, mirrorPath}) => {
            if (files.has(mirrorPath)) return content;
            files.add(mirrorPath);
            if (content === null) return content;
            for (const specifier of findReferences(content)) {
                if (specifier.startsWith('data:') || specifier.startsWith('blob:')) continue;
                if (!isRelativeSpecifier(specifier)) {
                    if (/^(https?:)?\/\//.test(specifier) || specifier.startsWith('/')) {
                        logger.warn(`  Not mirrored (not relative): ${specifier} in ${url}`);
                    }
                    continue;
                }
                const refURL = new URL(specifier, url).href;
                try {
                    await download(refURL, files);
                } catch (error) {
                    logger.warn(`  Failed to mirror ${refURL} referred from ${url}: ${error.message}`);
                }
            }
            return content;
        });
    };

    const extensions = [];
    const allFiles = new Set();
    for (const url of urls) {
        logger.info(`Mirroring extension: ${url}`);
        const files = new Set();
        try {
            const content = await download(url, files);
            if (!isValidExtensionContent(content)) {
                throw new Error('Invalid extension content');
            }
            const record = {
                url: url,
                extensionURL: url,
                entry: mirrorPathOf(url),
                module: mirrorPathOf(url)
            };
            if (hasOnlyEntry(content)) {
                // Entry-only module: the blockClass is in the module of the declared extensionURL.
                const declaredURL = extractExtensionURL(content);
                if (!declaredURL) {
                    throw new Error('extensionURL not found in the entry-only module');
                }
                const blockClassURL = new URL(declaredURL, url).href;
                logger.info(`  Entry-only module, blockClass from: ${blockClassURL}`);
                const blockClassContent = await download(blockClassURL, files);
                if (!blockClassContent || !blockClassContent.includes('blockClass')) {
                    throw new Error(`blockClass not found in module for ${blockClassURL}`);
                }
                record.extensionURL = blockClassURL;
                record.module = mirrorPathOf(blockClassURL);
            }
            extensions.push(record);
            files.forEach(file => allFiles.add(file));
        } catch (error) {
            logger.warn(`Failed to mirror extension ${url}: ${error.message}`);
        }
    }

    const manifest = {
        version: MANIFEST_VERSION,
        name: name || path.basename(path.resolve(outDir)),
        generatedAt: new Date().toISOString()
    };
    if (originTimeout) manifest.originTimeout = originTimeout;
    manifest.files = Array.from(allFiles).sort();
    manifest.extensions = extensions;
    fs.writeFileSync(path.join(outDir, MANIFEST_FILE_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    logger.info(`Mirrored ${extensions.length}/${urls.length} extensions (${manifest.files.length} files) ` +
        `into ${outDir}`);
    return manifest;
};

/**
 * Read URLs from a rules file: `{"approved": [url, ...]}` or `[url, ...]`.
 * @param {string} rulesPath - path to the rules file
 * @returns {Array<string>} URLs
 */
export const readRules = rulesPath => {
    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    const urls = Array.isArray(rules) ? rules : rules.approved;
    if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string')) {
        throw new Error(`Invalid rules file: ${rulesPath}`);
    }
    return urls;
};

const usage = `Usage: node preload-mirror.mjs --rules <rules.json> --out <dir> [options]

Options:
  --rules <file>            JSON file: {"approved": ["https://.../extension.mjs", ...]}
  --out <dir>               output directory (e.g. <editor build>/preload)
  --name <name>             name of the set written in the manifest (default: directory name)
  --origin-timeout <ms>     timeout for trying the original URL before the mirror in the editor
  --fetch-timeout <ms>      timeout for each download (default: ${DEFAULT_FETCH_TIMEOUT})
  --insecure                do not verify TLS certificates (for local development servers)
  --help                    show this help`;

const main = async () => {
    const {values} = parseArgs({
        options: {
            'rules': {type: 'string'},
            'out': {type: 'string'},
            'name': {type: 'string'},
            'origin-timeout': {type: 'string'},
            'fetch-timeout': {type: 'string'},
            'insecure': {type: 'boolean'},
            'help': {type: 'boolean'}
        }
    });
    if (values.help || !values.rules || !values.out) {
        console.log(usage);
        process.exit(values.help ? 0 : 1);
    }
    if (values.insecure) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    const toNumber = (value, option) => {
        if (typeof value === 'undefined') return;
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) {
            throw new Error(`Invalid ${option}: ${value}`);
        }
        return number;
    };
    await mirrorExtensions({
        urls: readRules(values.rules),
        outDir: values.out,
        name: values.name,
        originTimeout: toNumber(values['origin-timeout'], '--origin-timeout'),
        fetchTimeout: toNumber(values['fetch-timeout'], '--fetch-timeout')
    });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then(
        () => process.exit(0),
        error => {
            console.error(error);
            process.exit(1);
        }
    );
}
