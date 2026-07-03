import {isRtl} from 'scratch-l10n';
import editorMessages from 'scratch-l10n/locales/editor-msgs';
import missingTranslations from '../lib/missing-translations.js';
import extensionLibraryTranslations from '../containers/extension-library-translations.js';
import xcratchTagTranslations from '../lib/libraries/xcratch-tag-translations.js';
import xcratchCategoryTranslations from '../lib/libraries/xcratch-category-translations.js';
import blocksToImageTranslations from '../lib/blocks-to-image-translations.js';
import editValueInEditorTranslations from '../lib/edit-value-in-editor-translations.js';
import listEditorTranslations from '../lib/list-editor-translations.js';
import localProjectTranslations from '../lib/local-project-translations.js';

Object.keys(missingTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...missingTranslations[locale]
    };
});

Object.keys(extensionLibraryTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...extensionLibraryTranslations[locale]
    };
});

Object.keys(xcratchTagTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...xcratchTagTranslations[locale]
    };
});

Object.keys(xcratchCategoryTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...xcratchCategoryTranslations[locale]
    };
});

Object.keys(blocksToImageTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...blocksToImageTranslations[locale]
    };
});

Object.keys(editValueInEditorTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...editValueInEditorTranslations[locale]
    };
});

Object.keys(listEditorTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...listEditorTranslations[locale]
    };
});

Object.keys(localProjectTranslations).forEach(locale => {
    editorMessages[locale] = {
        ...(editorMessages[locale] || {}),
        ...localProjectTranslations[locale]
    };
});

const UPDATE_LOCALES = 'scratch-gui/locales/UPDATE_LOCALES';
const SELECT_LOCALE = 'scratch-gui/locales/SELECT_LOCALE';

const initialState = {
    isRtl: false,
    locale: 'en',
    messagesByLocale: editorMessages,
    messages: editorMessages.en
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SELECT_LOCALE:
        return Object.assign({}, state, {
            isRtl: isRtl(action.locale),
            locale: action.locale,
            messagesByLocale: state.messagesByLocale,
            messages: state.messagesByLocale[action.locale]
        });
    case UPDATE_LOCALES:
        return Object.assign({}, state, {
            isRtl: state.isRtl,
            locale: state.locale,
            messagesByLocale: action.messagesByLocale,
            messages: action.messagesByLocale[state.locale]
        });
    default:
        return state;
    }
};

const selectLocale = function (locale) {
    return {
        type: SELECT_LOCALE,
        locale: locale
    };
};

const setLocales = function (localesMessages) {
    return {
        type: UPDATE_LOCALES,
        messagesByLocale: localesMessages
    };
};
const initLocale = function (currentState, locale) {
    if (Object.prototype.hasOwnProperty.call(currentState.messagesByLocale, locale)) {
        return Object.assign(
            {},
            currentState,
            {
                isRtl: isRtl(locale),
                locale: locale,
                messagesByLocale: currentState.messagesByLocale,
                messages: currentState.messagesByLocale[locale]
            }
        );
    }
    // don't change locale if it's not in the current messages
    return currentState;
};
export {
    reducer as default,
    initialState as localesInitialState,
    initLocale,
    selectLocale,
    setLocales
};
