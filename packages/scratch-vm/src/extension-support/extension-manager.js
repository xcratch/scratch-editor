const dispatch = require('../dispatch/central-dispatch');
const log = require('../util/log');
const maybeFormatMessage = require('../util/maybe-format-message');

const BlockType = require('./block-type');

// These extensions are currently built into the VM repository but should not be loaded at startup.
// TODO: move these out into a separate repository?
// TODO: change extension spec so that library info, including extension ID, can be collected through static methods

const builtinExtensions = {
    // This is an example that isn't loaded with the other core blocks,
    // but serves as a reference for loading core blocks as extensions.
    coreExample: () => require('../blocks/scratch3_core_example'),
    // These are the non-core built-in extensions.
    pen: () => require('../extensions/scratch3_pen'),
    wedo2: () => require('../extensions/scratch3_wedo2'),
    music: () => require('../extensions/scratch3_music'),
    microbit: () => require('../extensions/scratch3_microbit'),
    text2speech: () => require('../extensions/scratch3_text2speech'),
    translate: () => require('../extensions/scratch3_translate'),
    videoSensing: () => require('../extensions/scratch3_video_sensing'),
    ev3: () => require('../extensions/scratch3_ev3'),
    makeymakey: () => require('../extensions/scratch3_makeymakey'),
    boost: () => require('../extensions/scratch3_boost'),
    gdxfor: () => require('../extensions/scratch3_gdx_for'),
    faceSensing: () => require('../extensions/scratch3_face_sensing')
};

/**
 * @typedef {object} ArgumentInfo - Information about an extension block argument
 * @property {ArgumentType} type - the type of value this argument can take
 * @property {*|undefined} default - the default value of this argument (default: blank)
 */

/**
 * @typedef {object} ConvertedBlockInfo - Raw extension block data paired with processed data ready for scratch-blocks
 * @property {ExtensionBlockMetadata} info - the raw block info
 * @property {object} json - the scratch-blocks JSON definition for this block
 * @property {string} xml - the scratch-blocks XML definition for this block
 */

/**
 * @typedef {object} CategoryInfo - Information about a block category
 * @property {string} id - the unique ID of this category
 * @property {string} name - the human-readable name of this category
 * @property {string|undefined} blockIconURI - optional URI for the block icon image
 * @property {string} color1 - the primary color for this category, in '#rrggbb' format
 * @property {string} color2 - the secondary color for this category, in '#rrggbb' format
 * @property {string} color3 - the tertiary color for this category, in '#rrggbb' format
 * @property {Array.<ConvertedBlockInfo>} blocks - the blocks, separators, etc. in this category
 * @property {Array.<object>} menus - the menus provided by this category
 */

/**
 * @typedef {object} PendingExtensionWorker - Information about an extension worker still initializing
 * @property {string} extensionURL - the URL of the extension to be loaded by this worker
 * @property {Function} resolve - function to call on successful worker startup
 * @property {Function} reject - function to call on failed worker startup
 */

class ExtensionManager {
    constructor (runtime, vm) {
        /**
         * The ID number to provide to the next extension worker.
         * @type {int}
         */
        this.nextExtensionWorker = 0;

        /**
         * FIFO queue of extensions which have been requested but not yet loaded in a worker,
         * along with promise resolution functions to call once the worker is ready or failed.
         * @type {Array.<PendingExtensionWorker>}
         */
        this.pendingExtensions = [];

        /**
         * Map of worker ID to workers which have been allocated but have not yet finished initialization.
         * @type {Array.<PendingExtensionWorker>}
         */
        this.pendingWorkers = [];

        /**
         * Map of loaded extension URLs/IDs (equivalent for built-in extensions) to service name.
         * @type {Map.<string,string>}
         * @private
         */
        this._loadedExtensions = new Map();

        /**
         * Keep a reference to the runtime so we can construct internal extension objects.
         * TODO: remove this in favor of extensions accessing the runtime as a service.
         * @type {Runtime}
         */
        this.runtime = runtime;
        this.vm = vm || null;

        dispatch.setService('extensions', this).catch(e => {
            log.error(`ExtensionManager was unable to register extension service: ${JSON.stringify(e)}`);
        });

        /**
         * The list of preloaded extension classes.
         * @type {Map.<string,object>}
         */
        this.preloadedExtensions = new Map();
    }

    /**
     * Check whether an extension is registered or is in the process of loading. This is intended to control loading or
     * adding extensions so it may return `true` before the extension is ready to be used. Use the promise returned by
     * `loadExtensionURL` if you need to wait until the extension is truly ready.
     * @param {string} extensionID - the ID of the extension.
     * @returns {boolean} - true if loaded, false otherwise.
     */
    isExtensionLoaded (extensionID) {
        return this._loadedExtensions.has(extensionID);
    }

    /**
     * Synchronously load an internal extension (core or non-core) by ID. This call will
     * fail if the provided id is not does not match an internal extension.
     * @param {string} extensionId - the ID of an internal extension
     */
    loadExtensionIdSync (extensionId) {
        if (!Object.prototype.hasOwnProperty.call(builtinExtensions, extensionId)) {
            log.warn(`Could not find extension ${extensionId} in the built in extensions.`);
            return;
        }

        /** @TODO dupe handling for non-builtin extensions. See commit 670e51d33580e8a2e852b3b038bb3afc282f81b9 */
        if (this.isExtensionLoaded(extensionId)) {
            const message = `Rejecting attempt to load a second extension with ID ${extensionId}`;
            log.warn(message);
            return;
        }

        const extension = builtinExtensions[extensionId]();
        const extensionInstance = new extension(this.runtime);
        const serviceName = this._registerInternalExtension(extensionInstance);
        this._loadedExtensions.set(extensionId, serviceName);
    }

    /**
     * Load a TurboWarp-compatible extension (calls Scratch.extensions.register()) via a script tag.
     * @param {string} extensionURL - URL for the extension script.
     * @returns {Promise<{entry: object, blockClass: Function}>}
     */
    fetchExtensionTurboWarp (extensionURL) {
        const vm = this.vm || this.runtime;
        return new Promise((resolve, reject) => {
            const previousScratch = window.Scratch;
            let settled = false;
            const settle = fn => (...args) => {
                if (settled) return;
                settled = true;
                window.Scratch = previousScratch;
                fn(...args);
            };

            // Build the Scratch global following TurboWarp's unsandboxed extension API.
            const Scratch = {
                BlockType: require('./block-type'),
                ArgumentType: require('./argument-type'),
                TargetType: require('./target-type'),
                Cast: require('../util/cast'),
                vm,
                renderer: vm.runtime ? vm.runtime.renderer : vm.renderer,
                extensions: {
                    unsandboxed: true,
                    register: instance => {
                        const info = instance.getInfo();
                        if (!info || !info.id) {
                            settle(reject)(new Error('Extension getInfo() returned invalid data'));
                            return;
                        }
                        const entry = {
                            extensionId: info.id,
                            extensionURL: extensionURL,
                            name: info.name || info.id,
                            iconURL: info.blockIconURI || null,
                            insetIconURL: info.menuIconURI || null
                        };
                        const blockClass = instance.constructor;
                        blockClass.extensionURL = extensionURL;
                        settle(resolve)({entry, blockClass});
                    }
                }
            };

            // Minimal translate shim: translate.setup() stores translations,
            // translate(msg) returns the default message string.
            let storedTranslations = {};
            const getLocale = () => (vm && vm.getLocale ? vm.getLocale() : navigator.language);
            const translate = msg => {
                if (msg && typeof msg === 'object') {
                    const locale = getLocale();
                    const translations = storedTranslations[locale] || {};
                    const id = msg.id || `_${msg.default}`;
                    return translations[id] || msg.default || String(msg);
                }
                return String(msg);
            };
            translate.setup = newTranslations => {
                if (newTranslations) storedTranslations = newTranslations;
            };
            Scratch.translate = translate;

            // Permissioned fetch — allow all fetches in xcratch (no securityManager).
            Scratch.fetch = (url, options) => fetch(url, options);
            Scratch.canFetch = () => Promise.resolve(true);
            Scratch.openWindow = (url, features) => window.open(url, '_blank',
                features ? `noreferrer,${features}` : 'noreferrer');
            Scratch.canOpenWindow = () => Promise.resolve(true);
            Scratch.redirect = url => {
                location.href = url;
            };
            Scratch.canRedirect = () => Promise.resolve(true);

            window.Scratch = Scratch;

            const script = document.createElement('script');
            script.src = extensionURL;
            script.onerror = () => {
                settle(reject)(new Error(`Failed to load script: ${extensionURL}`));
            };
            document.body.appendChild(script);
        });
    }

    /**
     * Resolve a module URL which may be relative against the base URL.
     * @param {string} url - absolute URL or path relative to baseURL.
     * @param {string} baseURL - URL to resolve a relative path against.
     * @returns {string} absolute URL.
     */
    resolveModuleURL (url, baseURL) {
        if (url.match(/^https?:\/\//)) {
            return url;
        }
        const base = new URL(baseURL, window.location.href);
        return new URL(url, base).href;
    }

    /**
     * Import the module which exports the block class.
     * @param {string} blockClassURL - absolute URL for module of the block class.
     * @returns {Promise<BlockClass>} block class exported by the module.
     */
    fetchBlockClass (blockClassURL) {
        return import(/* webpackIgnore: true */ blockClassURL)
            .then(blockModule => {
                if (!blockModule.blockClass) {
                    throw new Error(`blockClass not found in module for ${blockClassURL}`);
                }
                return blockModule.blockClass;
            });
    }

    /**
     * Fetch URL and return entry object and block class of the extension.
     * @param {string} extensionURL - URL for module of the extension.
     * @returns {{entry: object, blockClass: BlockClass}} Array with entry and block class of the extension.
     */
    fetchExtension (extensionURL) {
        return import(/* webpackIgnore: true */ extensionURL)
            .then(module => {
                if (!module.entry) {
                    throw new Error(`Entry not found in module for ${extensionURL}`);
                }
                const entry = module.entry;
                // extensionURL declared in the entry: for an entry-only module it points to the module
                // which contains the blockClass. Keep it before overwriting with the loaded URL.
                const declaredURL = entry.extensionURL;
                entry.extensionURL = extensionURL;

                // If entry has blockClassURL, import blockClass from that URL
                if (entry.blockClassURL) {
                    const blockClassURL = this.resolveModuleURL(entry.blockClassURL, extensionURL);
                    return this.fetchBlockClass(blockClassURL)
                        .then(blockClass => {
                            blockClass.extensionURL = extensionURL;
                            return {entry: entry, blockClass: blockClass};
                        });
                }

                // Otherwise, use blockClass from the same module (old format)
                if (module.blockClass) {
                    const blockClass = module.blockClass;
                    blockClass.extensionURL = extensionURL;
                    return {entry: entry, blockClass: blockClass};
                }

                // Entry-only module: the declared extensionURL points to the module which contains the blockClass.
                const blockClassURL = (typeof declaredURL === 'string' && declaredURL) ?
                    this.resolveModuleURL(declaredURL, extensionURL) :
                    null;
                if (blockClassURL && blockClassURL !== extensionURL) {
                    return this.fetchBlockClass(blockClassURL)
                        .then(blockClass => {
                            // Record the blockClass module URL as the module URL of the extension
                            // so that the project can be re-loaded from it.
                            entry.extensionURL = blockClassURL;
                            blockClass.extensionURL = blockClassURL;
                            return {entry: entry, blockClass: blockClass};
                        });
                }
                throw new Error(`blockClass not found in module for ${extensionURL}`);
            });
    }

    addBultinExtension (entry, blockClass) {
        builtinExtensions[entry.extensionId] = () => blockClass;
        this.extensionLibraryContent.unshift(entry);
    }

    /**
     * Instanceate new block object and register that in the runtime.
     * @param {object} entry - Entry object to register.
     * @param {Function} blockClass - Class of block object to register.
     * @param {boolean} preload - Whether the extension is preloaded. Default is false.
     */
    registerExtensionBlock (entry, blockClass, preload = false) {
        if (preload) {
            if (this.isExtensionLoaded(entry.extensionId)) {
                // Do not preload the extension if it is already loaded.
                return;
            }
            if (Array.from(this.preloadedExtensions.values())
                .some(preloaded => preloaded.entry.extensionId === entry.extensionId)) {
                // Do not preload the extension if it is already preloaded.
                return;
            }
            entry.category = 'preloaded';
            this.preloadedExtensions.set(entry.extensionURL, {entry: entry, blockClass: blockClass});
            return;
        }
        const extensionInstance = new blockClass(this.runtime);
        const extensionID = extensionInstance.getInfo().id;
        if (entry.extensionId !== extensionID) {
            // Reject by the security risk.
            throw new Error(`Extension ID mismatch entry: '${entry.extensionId}' block: '${extensionID}'`);
        }
        entry.category = 'loaded';
        if (this.isExtensionLoaded(extensionID)) {
            // Remove from loaded extensions
            const oldServiceName = this._loadedExtensions.get(extensionID);
            this._loadedExtensions.delete(extensionID);
            // Remove from dispatcher
            delete dispatch.services[oldServiceName];
            // Remove from block info
            const oldBlockInfoIndex = this.runtime._blockInfo.findIndex(info => info.id === extensionID);
            if (oldBlockInfoIndex >= 0) {
                this.runtime._blockInfo.splice(oldBlockInfoIndex, 1);
            }
        }
        const serviceName = this._registerInternalExtension(extensionInstance);
        this._loadedExtensions.set(extensionID, serviceName);
        // Ensure the extension URL is stored on the runtime block info so that
        // project serialization records it for re-loading from the network.
        if (entry.extensionURL) {
            const categoryInfo = this.runtime._blockInfo.find(info => info.id === extensionID);
            if (categoryInfo) {
                categoryInfo.extensionURL = entry.extensionURL;
            }
        }
        const oldEntryIndex = this.extensionLibraryContent
            .findIndex(libEntry => libEntry.extensionId === extensionID);
        if (oldEntryIndex >= 0) {
            // Remove from extension library
            this.extensionLibraryContent.splice(oldEntryIndex, 1);
        }
        if (this.extensionLibraryContent) {
            this.extensionLibraryContent.unshift(entry);
        }
        return;
    }

    /**
     * Load an extension by URL or internal extension ID
     * @param {string} extensionURL - the URL for the extension to load OR the ID of an internal extension
     * @returns {Promise} resolved once the extension is loaded and initialized or rejected on failure
     */
    loadExtensionURL (extensionURL) {
        if (Object.prototype.hasOwnProperty.call(builtinExtensions, extensionURL)) {
            /** @TODO dupe handling for non-builtin extensions. See commit 670e51d33580e8a2e852b3b038bb3afc282f81b9 */
            if (this.isExtensionLoaded(extensionURL)) {
                const message = `Rejecting attempt to load a second extension with ID ${extensionURL}`;
                log.warn(message);
                return Promise.resolve();
            }

            const extension = builtinExtensions[extensionURL]();
            const extensionInstance = new extension(this.runtime);
            const serviceName = this._registerInternalExtension(extensionInstance);
            this._loadedExtensions.set(extensionURL, serviceName);
            return Promise.resolve();
        }

        // Find a builtin extension which have the extensionURL.
        const builtinClassFunc = Object.values(builtinExtensions)
            .find(blockClassFunc => blockClassFunc().extensionURL === extensionURL);
        if (builtinClassFunc) {
            const blockClass = builtinClassFunc();
            const extensionInstance = new blockClass(this.runtime);
            const serviceName = this._registerInternalExtension(extensionInstance);
            this._loadedExtensions.set(blockClass.EXTENSION_ID, serviceName);
            return Promise.resolve();
        }

        // To access the runtime even in outer extensions, it loaded by dynamic import() instead of extension-worker.
        // Try xcratch format first, then TurboWarp format, then fall back to preloaded version.
        return this.fetchExtension(extensionURL)
            .then(({entry, blockClass}) => {
                this.registerExtensionBlock(entry, blockClass);
            })
            .catch(() => this.fetchExtensionTurboWarp(extensionURL)
                .then(({entry, blockClass}) => {
                    this.registerExtensionBlock(entry, blockClass);
                })
            )
            .catch(error => {
                // If the extension is preloaded, register it.
                const preloadedExt = this.preloadedExtensions.get(extensionURL);
                if (preloadedExt) {
                    this.registerExtensionBlock(preloadedExt.entry, preloadedExt.blockClass);
                    log.info(`Failed to load from URL, using preloaded extension: ${extensionURL}`);
                } else {
                    throw error;
                }
            })
            .catch(error => {
                log.error(`Failed to load extension: ${extensionURL}: ${error}`);
                // Ignore error to continue loading lest of the project data.
            });
    }

    /**
     * Regenerate blockinfo for any loaded extensions
     * @returns {Promise} resolved once all the extensions have been reinitialized
     */
    refreshBlocks () {
        const allPromises = Array.from(this._loadedExtensions.values()).map(serviceName =>
            dispatch.call(serviceName, 'getInfo')
                .then(info => {
                    info = this._prepareExtensionInfo(serviceName, info);
                    dispatch.call('runtime', '_refreshExtensionPrimitives', info);
                })
                .catch(e => {
                    log.error(`Failed to refresh built-in extension primitives: ${JSON.stringify(e)}`);
                })
        );
        return Promise.all(allPromises);
    }

    allocateWorker () {
        const id = this.nextExtensionWorker++;
        const workerInfo = this.pendingExtensions.shift();
        this.pendingWorkers[id] = workerInfo;
        return [id, workerInfo.extensionURL];
    }

    /**
     * Synchronously collect extension metadata from the specified service and begin the extension registration process.
     * @param {string} serviceName - the name of the service hosting the extension.
     */
    registerExtensionServiceSync (serviceName) {
        const info = dispatch.callSync(serviceName, 'getInfo');
        this._registerExtensionInfo(serviceName, info);
    }

    /**
     * Collect extension metadata from the specified service and begin the extension registration process.
     * @param {string} serviceName - the name of the service hosting the extension.
     */
    registerExtensionService (serviceName) {
        dispatch.call(serviceName, 'getInfo').then(info => {
            this._registerExtensionInfo(serviceName, info);
        });
    }

    /**
     * Called by an extension worker to indicate that the worker has finished initialization.
     * @param {int} id - the worker ID.
     * @param {*?} e - the error encountered during initialization, if any.
     */
    onWorkerInit (id, e) {
        const workerInfo = this.pendingWorkers[id];
        delete this.pendingWorkers[id];
        if (e) {
            workerInfo.reject(e);
        } else {
            workerInfo.resolve(id);
        }
    }

    /**
     * Register an internal (non-Worker) extension object
     * @param {object} extensionObject - the extension object to register
     * @returns {string} The name of the registered extension service
     */
    _registerInternalExtension (extensionObject) {
        const extensionInfo = extensionObject.getInfo();
        const fakeWorkerId = this.nextExtensionWorker++;
        const serviceName = `extension_${fakeWorkerId}_${extensionInfo.id}`;
        dispatch.setServiceSync(serviceName, extensionObject);
        dispatch.callSync('extensions', 'registerExtensionServiceSync', serviceName);
        return serviceName;
    }

    /**
     * Sanitize extension info then register its primitives with the VM.
     * @param {string} serviceName - the name of the service hosting the extension
     * @param {ExtensionInfo} extensionInfo - the extension's metadata
     * @private
     */
    _registerExtensionInfo (serviceName, extensionInfo) {
        extensionInfo = this._prepareExtensionInfo(serviceName, extensionInfo);
        dispatch.call('runtime', '_registerExtensionPrimitives', extensionInfo).catch(e => {
            log.error(`Failed to register primitives for extension on service ${serviceName}:`, e);
        });
    }

    /**
     * Modify the provided text as necessary to ensure that it may be used as an attribute value in valid XML.
     * @param {string} text - the text to be sanitized
     * @returns {string} - the sanitized text
     * @private
     */
    _sanitizeID (text) {
        return text.toString().replace(/[<"&]/, '_');
    }

    /**
     * Apply minor cleanup and defaults for optional extension fields.
     * TODO: make the ID unique in cases where two copies of the same extension are loaded.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {ExtensionInfo} extensionInfo - the extension info to be sanitized
     * @returns {ExtensionInfo} - a new extension info object with cleaned-up values
     * @private
     */
    _prepareExtensionInfo (serviceName, extensionInfo) {
        extensionInfo = Object.assign({}, extensionInfo);
        if (!/^[a-z0-9]+$/i.test(extensionInfo.id)) {
            throw new Error('Invalid extension id');
        }
        extensionInfo.name = extensionInfo.name || extensionInfo.id;
        extensionInfo.blocks = extensionInfo.blocks || [];
        extensionInfo.targetTypes = extensionInfo.targetTypes || [];
        extensionInfo.blocks = extensionInfo.blocks.reduce((results, blockInfo) => {
            try {
                let result;
                switch (blockInfo) {
                case '---': // separator
                    result = '---';
                    break;
                default: // an ExtensionBlockMetadata object
                    result = this._prepareBlockInfo(serviceName, blockInfo);
                    break;
                }
                results.push(result);
            } catch (e) {
                // TODO: more meaningful error reporting
                log.error(`Error processing block: ${e.message}, Block:\n${JSON.stringify(blockInfo)}`);
            }
            return results;
        }, []);
        extensionInfo.menus = extensionInfo.menus || {};
        extensionInfo.menus = this._prepareMenuInfo(serviceName, extensionInfo.menus);
        return extensionInfo;
    }

    /**
     * Prepare extension menus. e.g. setup binding for dynamic menu functions.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {Array.<MenuInfo>} menus - the menu defined by the extension.
     * @returns {Array.<MenuInfo>} - a menuInfo object with all preprocessing done.
     * @private
     */
    _prepareMenuInfo (serviceName, menus) {
        const menuNames = Object.getOwnPropertyNames(menus);
        for (let i = 0; i < menuNames.length; i++) {
            const menuName = menuNames[i];
            let menuInfo = menus[menuName];

            // If the menu description is in short form (items only) then normalize it to general form: an object with
            // its items listed in an `items` property.
            if (!menuInfo.items) {
                menuInfo = {
                    items: menuInfo
                };
                menus[menuName] = menuInfo;
            }
            // If `items` is a string, it should be the name of a function in the extension object. Calling the
            // function should return an array of items to populate the menu when it is opened.
            if (typeof menuInfo.items === 'string') {
                const menuItemFunctionName = menuInfo.items;
                const serviceObject = dispatch.services[serviceName];
                // Bind the function here so we can pass a simple item generation function to Scratch Blocks later.
                menuInfo.items = this._getExtensionMenuItems.bind(this, serviceObject, menuItemFunctionName);
            }
        }
        return menus;
    }

    /**
     * Fetch the items for a particular extension menu, providing the target ID for context.
     * @param {object} extensionObject - the extension object providing the menu.
     * @param {string} menuItemFunctionName - the name of the menu function to call.
     * @returns {Array} menu items ready for scratch-blocks.
     * @private
     */
    _getExtensionMenuItems (extensionObject, menuItemFunctionName) {
        // Fetch the items appropriate for the target currently being edited. This assumes that menus only
        // collect items when opened by the user while editing a particular target.
        const editingTarget = this.runtime.getEditingTarget() || this.runtime.getTargetForStage();
        const editingTargetID = editingTarget ? editingTarget.id : null;
        const extensionMessageContext = this.runtime.makeMessageContextForTarget(editingTarget);

        // TODO: Fix this to use dispatch.call when extensions are running in workers.
        const menuFunc = extensionObject[menuItemFunctionName];
        const menuItems = menuFunc.call(extensionObject, editingTargetID).map(
            item => {
                item = maybeFormatMessage(item, extensionMessageContext);
                switch (typeof item) {
                case 'object':
                    return [
                        maybeFormatMessage(item.text, extensionMessageContext),
                        item.value
                    ];
                case 'string':
                    return [item, item];
                default:
                    return item;
                }
            });

        if (!menuItems || menuItems.length < 1) {
            throw new Error(`Extension menu returned no items: ${menuItemFunctionName}`);
        }
        return menuItems;
    }

    /**
     * Apply defaults for optional block fields.
     * @param {string} serviceName - the name of the service hosting this extension block
     * @param {ExtensionBlockMetadata} blockInfo - the block info from the extension
     * @returns {ExtensionBlockMetadata} - a new block info object which has values for all relevant optional fields.
     * @private
     */
    _prepareBlockInfo (serviceName, blockInfo) {
        blockInfo = Object.assign({}, {
            blockType: BlockType.COMMAND,
            terminal: false,
            blockAllThreads: false,
            arguments: {}
        }, blockInfo);
        blockInfo.opcode = blockInfo.opcode && this._sanitizeID(blockInfo.opcode);
        blockInfo.text = blockInfo.text || blockInfo.opcode;

        switch (blockInfo.blockType) {
        case BlockType.EVENT:
            if (blockInfo.func) {
                log.warn(`Ignoring function "${blockInfo.func}" for event block ${blockInfo.opcode}`);
            }
            break;
        case BlockType.BUTTON:
            if (blockInfo.opcode) {
                log.warn(`Ignoring opcode "${blockInfo.opcode}" for button with text: ${blockInfo.text}`);
            }
            break;
        default: {
            if (!blockInfo.opcode) {
                throw new Error('Missing opcode for block');
            }

            const funcName = blockInfo.func ? this._sanitizeID(blockInfo.func) : blockInfo.opcode;

            const getBlockInfo = blockInfo.isDynamic ?
                args => args && args.mutation && args.mutation.blockInfo :
                () => blockInfo;
            const callBlockFunc = (() => {
                if (dispatch._isRemoteService(serviceName)) {
                    return (args, util, realBlockInfo) =>
                        dispatch.call(serviceName, funcName, args, util, realBlockInfo);
                }

                // avoid promise latency if we can call direct
                const serviceObject = dispatch.services[serviceName];
                if (!serviceObject[funcName]) {
                    // The function might show up later as a dynamic property of the service object
                    log.warn(`Could not find extension block function called ${funcName}`);
                }
                return (args, util, realBlockInfo) =>
                    serviceObject[funcName](args, util, realBlockInfo);
            })();

            blockInfo.func = (args, util) => {
                const realBlockInfo = getBlockInfo(args);
                // TODO: filter args using the keys of realBlockInfo.arguments? maybe only if sandboxed?
                return callBlockFunc(args, util, realBlockInfo);
            };
            break;
        }
        }

        return blockInfo;
    }
}

module.exports = ExtensionManager;
