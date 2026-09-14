import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from '@scratch/scratch-vm';
import {defineMessages, injectIntl} from 'react-intl';
import intlShape from '../lib/intlShape.js';
import log from '../lib/log.js';

import extensionLibraryContent from '../lib/libraries/extensions/index.jsx';
import extensionTags from '../lib/libraries/extension-tags.js';

import LibraryComponent from '../components/library/library.jsx';
import extensionIcon from '../components/action-menu/icon--sprite.svg';

import {prompt, confirm, alert} from '../lib/async-modal.jsx';

const messages = defineMessages({
    extensionTitle: {
        defaultMessage: 'Choose an Extension',
        description: 'Heading for the extension library',
        id: 'gui.extensionLibrary.chooseAnExtension'
    },
    extensionUrl: {
        defaultMessage: 'Enter the URL of the extension',
        description: 'Prompt for unofficial extension url',
        id: 'gui.extensionLibrary.extensionUrl'
    },
    confirmReplacing: {
        defaultMessage: 'Do you want to replace extension\n\nextension name: {name}\nload from: {url}',
        description: 'Confirm for replacing of the extension',
        id: 'xcratch.extensionLibrary.confirmReplacingExtension'
    },
    couldNotLoadExtension: {
        defaultMessage: 'Could not load extension from: ',
        description: 'Error message when extension could not be loaded',
        id: 'xcratch.extensionLibrary.couldNotLoadExtension'
    },
    functionExtension: {
        defaultMessage: 'Function',
        description: 'Tag for filtering function enhancement extensions',
        id: 'xcratch.tag.functionExtension'
    },
    imageExtension: {
        defaultMessage: 'Image',
        description: 'Tag for filtering visual enhancement extensions',
        id: 'xcratch.tag.imageExtension'
    },
    soundExtension: {
        defaultMessage: 'Sound',
        description: 'Tag for filtering audio enhancement extensions',
        id: 'xcratch.tag.soundExtension'
    },
    textExtension: {
        defaultMessage: 'Text',
        description: 'Tag for filtering text enhancement extensions',
        id: 'xcratch.tag.textExtension'
    },
    calculationExtension: {
        defaultMessage: 'Calculation',
        description: 'Tag for filtering calculation enhancement extensions',
        id: 'xcratch.tag.calculationExtension'
    },
    networkExtension: {
        defaultMessage: 'Network',
        description: 'Tag for filtering network enhancement extensions',
        id: 'xcratch.tag.networkExtension'
    },
    deviceExtension: {
        defaultMessage: 'Device',
        description: 'Tag for filtering device enhancement extensions',
        id: 'xcratch.tag.deviceExtension'
    },
    aiExtension: {
        defaultMessage: 'AI',
        description: 'Tag for filtering AI enhancement extensions',
        id: 'xcratch.tag.aiExtension'
    }
});

/**
 * Holds the preloaded extensions
 * - url: source URL listed in preload-rules.json (entry-only module for separate type)
 * - extensionURL: URL of the module which contains the blockClass (used as the module URL of the extension)
 * @type {Array<{entry: object, blockClass: object|null, url: string, extensionURL: string,
 * isSeparate: boolean, blockClassContextKey?: string}>}
 */
let preloadedExtensions = [];
let preloaded = false;

/**
 * Load preloaded extensions
 * @returns {Promise<Array<{entry: object, blockClass: object}>>} - Preloaded extensions
 */
const loadModules = async () => {
    try {
        let extensions = [];
        try {
            // Check if preload.json exists at compile time and load it.
            const preloadContext = require.context(
                '../../preload',
                false,
                /^\.\/preload\.json$/,
                'lazy'
            );
            if (preloadContext.keys().includes('./preload.json')) {
                const preloadJson = await preloadContext('./preload.json');
                extensions = preloadJson.default || preloadJson;
            }
        } catch (e) {
            // This can happen if the preload directory does not exist.
            extensions = [];
        }
        
        if (!Array.isArray(extensions)) {
            log.warn('Invalid preload.json format');
            return preloadedExtensions;
        }

        // Create webpack context for preload directory (both entry.mjs and extension.mjs)
        let preloadModulesContext = null;
        try {
            preloadModulesContext = require.context(
                '../../preload',
                true,
                /\/(entry|extension)\.mjs$/,
                'lazy'
            );
        } catch (contextError) {
            return preloadedExtensions;
        }

        // Skip if no extensions to load
        if (extensions.length === 0) {
            return preloadedExtensions;
        }

        // Group files by directory
        const filesByDirectory = new Map();
        preloadModulesContext.keys().forEach(key => {
            const match = key.match(/^\.\/(.+)\/(entry|extension)\.mjs$/);
            if (match) {
                const [, dirPath, fileType] = match;
                if (!filesByDirectory.has(dirPath)) {
                    filesByDirectory.set(dirPath, {});
                }
                filesByDirectory.get(dirPath)[fileType] = key;
            }
        });

        // Load each extension module using webpack context
        const modules = await Promise.all(
            extensions.map(async ext => {
                try {
                    // Extract directory path from ext.path
                    const pathMatch = ext.path.match(/^(.+)\/(entry|extension)\.mjs$/);
                    if (!pathMatch) {
                        log.warn(`Invalid extension path format: ${ext.path}`);
                        return null;
                    }
                    
                    const dirPath = pathMatch[1];
                    const filesInDir = filesByDirectory.get(dirPath);
                    // URL of the module which contains the blockClass.
                    // For entry-only source, preload.mjs records the resolved extensionURL of the entry.
                    const extensionURL = ext.extensionURL || ext.url;
                    
                    if (!filesInDir) {
                        log.warn(`No files found for extension: ${ext.path}`);
                        return null;
                    }

                    // Determine if integrated or separate type
                    const hasEntry = !!filesInDir.entry;
                    const hasExtension = !!filesInDir.extension;
                    const isSeparate = hasEntry && hasExtension;

                    if (isSeparate) {
                        // Separate type: load only entry.mjs
                        const entryModule = await preloadModulesContext(filesInDir.entry);
                        return {
                            entry: entryModule.entry,
                            blockClass: null,
                            url: ext.url,
                            extensionURL: extensionURL,
                            isSeparate: true,
                            blockClassContextKey: filesInDir.extension
                        };
                    }
                    if (hasExtension) {
                        // Integrated type: load extension.mjs with both entry and blockClass
                        const extensionModule = await preloadModulesContext(filesInDir.extension);
                        return {
                            entry: extensionModule.entry,
                            blockClass: extensionModule.blockClass,
                            url: ext.url,
                            extensionURL: extensionURL,
                            isSeparate: false
                        };
                    }
                    log.warn(`Invalid extension structure for: ${ext.path}`);
                    return null;
                } catch (error) {
                    log.warn(`Failed to load extension ${ext.url}:`, error);
                    return null;
                }
            })
        );

        // Filter out failed loads
        preloadedExtensions = modules.filter(module => module && module.entry);

        // Sort by name
        preloadedExtensions.sort((a, b) => {
            const nameA = a.entry.name.defaultMessage ?
                a.entry.name.defaultMessage :
                a.entry.name;
            const nameB = b.entry.name.defaultMessage ?
                b.entry.name.defaultMessage :
                b.entry.name;
            return nameA.localeCompare(nameB);
        });

        // Register all preloaded extensions to the library
        preloadedExtensions.forEach(({entry, extensionURL}) => {
            entry.category = 'preloaded';
            // Use the URL of the module which contains the blockClass as the module URL of the extension,
            // so that the library card and the saved project refer to a loadable module.
            entry.extensionURL = extensionURL;
            // Check if extension is already in the library to prevent duplicates
            const existingIndex = extensionLibraryContent.findIndex(
                item => item.extensionId === entry.extensionId ||
                        (item.extensionURL && item.extensionURL === extensionURL)
            );
            if (existingIndex === -1) {
                extensionLibraryContent.push(entry);
            }
        });

        return preloadedExtensions;
    } catch (error) {
        log.info('Error loading preloaded extensions:', error);
        return preloadedExtensions;
    }
};

// Load preloaded extensions
loadModules().then(extensions => {
    log.info('Extensions preloaded:', extensions.map(({entry}) => entry.extensionId));
});

class ExtensionLibrary extends React.PureComponent {
    constructor (props) {
        super(props);
        extensionLibraryContent.forEach(extension => {
            if (extension.setFormatMessage) {
                extension.setFormatMessage(this.props.intl.formatMessage);
            }
            if (extension.translationMap) {
                Object.assign(
                    this.props.intl.messages,
                    extension.translationMap[this.props.intl.locale]
                );
            }
        });
        bindAll(this, [
            'handleItemSelect'
        ]);

        if (!preloaded) {
            // Set preloaded extensions into VM for fallback when loading extension class from URL.
            // Only register integrated type extensions (those with blockClass already loaded)
            preloadedExtensions.forEach(({entry, blockClass, isSeparate, extensionURL}) => {
                if (!isSeparate && blockClass) {
                    log.info(
                        `Registering preloaded integrated extension: ${entry.extensionId} with URL: ${extensionURL}`
                    );
                    this.props.vm.extensionManager
                        .registerExtensionBlock(entry, blockClass, true); // true: preloaded
                }
            });
            // Clear preloadedExtensions to avoid duplicate registration.
            preloaded = true;
        }
    }

    async handleItemSelect (item) {
        if (item.disabled) {
            return;
        }
        let id = item.extensionId;
        const url = item.extensionURL ? item.extensionURL : id;
        if (id) {
            if (this.props.vm.extensionManager.isExtensionLoaded(id)) {
                this.props.onCategorySelected(id);
                return Promise.resolve();
            }
            
            // Check if this is a preloaded extension
            const preloadedExt = preloadedExtensions.find(ext => ext.entry.extensionId === id);
            
            if (preloadedExt && preloadedExt.isSeparate && preloadedExt.blockClassContextKey) {
                // Separate type preloaded extension
                try {
                    // Load blockClass dynamically for separate type extension
                    const preloadContext = require.context(
                        '../../preload',
                        true,
                        /\/(entry|extension)\.mjs$/,
                        'lazy'
                    );
                    
                    const extensionModule = await preloadContext(preloadedExt.blockClassContextKey);
                    
                    if (extensionModule && extensionModule.blockClass) {
                        // Register the blockClass to VM
                        this.props.vm.extensionManager
                            .registerExtensionBlock(preloadedExt.entry, extensionModule.blockClass);
                        this.props.onCategorySelected(id);
                    } else {
                        throw new Error('blockClass not found in extension module');
                    }
                } catch (error) {
                    log.warn(`Failed to dynamically load blockClass for ${id}:`, error);
                    // Fallback to loading from URL
                    return this.props.vm.extensionManager.loadExtensionURL(url)
                        .then(() => {
                            this.props.onCategorySelected(id);
                        });
                }
                return;
            }
            
            // Not a preloaded extension - load from URL
            return this.props.vm.extensionManager.loadExtensionURL(url)
                .then(() => {
                    this.props.onCategorySelected(id);
                });
        }
        let inputUrl = url;
        return prompt(
            {
                message: this.props.intl.formatMessage(messages.extensionUrl),
                valueType: 'url',
                initialValue: 'https://xcratch.github.io/xcx-example/dist/xcratchExample.mjs'
            })
            .then(userInput => {
                inputUrl = userInput;
                return this.props.vm.extensionManager.fetchExtension(userInput);
            })
            .catch(xcratchError => {
                log.info(`fetchExtension failed for ${inputUrl}, trying TurboWarp format:\n${xcratchError.message}`);
                return this.props.vm.extensionManager.fetchExtensionTurboWarp(inputUrl);
            })
            .then(({entry, blockClass}) => {
                id = entry.extensionId;
                const existingEntry = extensionLibraryContent.find(libEntry => libEntry.extensionId === id);
                if (existingEntry) {
                    return confirm(
                        {
                            message: this.props.intl.formatMessage(
                                messages.confirmReplacing,
                                {
                                    name: existingEntry.name.props ?
                                        this.props.intl.formatMessage(existingEntry.name.props) :
                                        existingEntry.name,
                                    url: blockClass.extensionURL
                                }
                            )
                        })
                        .then(doReplace => {
                            if (doReplace) {
                                this.props.vm.extensionManager.registerExtensionBlock(entry, blockClass);
                                return new Promise(resolve => {
                                    setTimeout(() => {
                                        this.props.onCategorySelected(id);
                                        resolve();
                                    });
                                });
                            }
                        });
                }
                this.props.vm.extensionManager.registerExtensionBlock(entry, blockClass);
                return new Promise(resolve => {
                    setTimeout(() => {
                        this.props.onCategorySelected(id);
                        resolve();
                    });
                });
            })
            .catch(error => {
                log.info(`Could not load extension class from ${inputUrl}:\n${error.stack}\n`);
                alert({
                    message: this.props.intl.formatMessage(
                        messages.couldNotLoadExtension,
                        {url: inputUrl}
                    )
                });
                return Promise.reject(error);
            });
        
    }

    render () {
        const extensionLibraryThumbnailData = extensionLibraryContent.map(extension => ({
            rawURL: extension.iconURL || extensionIcon,
            ...extension
        }));
        return (
            <LibraryComponent
                data={extensionLibraryThumbnailData}
                filterable
                tags={extensionTags}
                withCategories
                id="extensionLibrary"
                title={this.props.intl.formatMessage(messages.extensionTitle)}
                visible={this.props.visible}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
                showNewFeatureCallouts={this.props.showNewFeatureCallouts}
                username={this.props.username}
            />
        );
    }
}

ExtensionLibrary.propTypes = {
    intl: intlShape.isRequired,
    onCategorySelected: PropTypes.func,
    onRequestClose: PropTypes.func,
    visible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired,
    username: PropTypes.string,
    showNewFeatureCallouts: PropTypes.bool
};

export default injectIntl(ExtensionLibrary);
