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
            
            // A preloaded extension is loaded in the same way: the VM falls back to its mirror.
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
