import React from 'react';
import ReactDomClient from 'react-dom/client';

import AppStateHOC from '../lib/app-state-hoc.jsx';
import GUI from '../containers/gui.jsx';
import HashParserHOC from '../lib/hash-parser-hoc.jsx';
import LocalProjectHOC from '../lib/local-project-hoc.jsx';
import {
    LocalProjectStorage,
    getLastLocalProjectId,
    setLastLocalProjectId,
    isLocalProjectId,
    localProjectExists
} from '../lib/local-project-storage';
import log from '../lib/log.js';
import {PLATFORM} from '../lib/platform.js';

const onClickLogo = () => {
    window.location = 'https://xcratch.github.io';
};

const handleTelemetryModalCancel = () => {
    log('User canceled telemetry modal');
};

const handleTelemetryModalOptIn = () => {
    log('User opted into telemetry');
};

const handleTelemetryModalOptOut = () => {
    log('User opted out of telemetry');
};

const localStorageConfigFactory = () => ({storage: new LocalProjectStorage()});

// Reflect the local project id into the URL hash (via replaceState, so no
// hashchange event fires and HashParserHOC doesn't refetch) and remember it
// for the next visit.
const updateProjectIdInHash = projectId => {
    const id = String(projectId);
    if (!isLocalProjectId(id)) return;
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
    setLastLocalProjectId(id);
};

/**
 * Decide which project to open before mounting:
 * - keep a `#https://...` or existing local `#<id>` hash as-is
 * - clear a hash pointing at a deleted local project (avoids the error page)
 * - with no hash, resume the last opened local project if it still exists
 */
const prepareInitialProject = async () => {
    const hashValue = decodeURIComponent(window.location.hash.substr(1));
    if (/^(http|https):\/\//.test(hashValue)) return;
    const hashMatch = window.location.hash.match(/#(\d+)/);
    if (hashMatch) {
        const exists = await localProjectExists(hashMatch[1]);
        if (!exists) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return;
    }
    const lastId = getLastLocalProjectId();
    if (lastId && await localProjectExists(lastId)) {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${lastId}`);
    }
};

/*
 * Render the GUI playground. This is a separate function because importing anything
 * that instantiates the VM causes unsupported browsers to crash
 * {object} appTarget - the DOM element to render to
 */
export default appTarget => {
    GUI.setAppElement(appTarget);

    // TODO a hack for testing the backpack, allow backpack host to be set by url param
    const backpackHostMatches = window.location.href.match(/[?&]backpack_host=([^&]*)&?/);
    const backpackHost = backpackHostMatches ? backpackHostMatches[1] : 'localStorage';

    const scratchDesktopMatches = window.location.href.match(/[?&]isScratchDesktop=([^&]+)/);
    let simulateScratchDesktop;
    if (scratchDesktopMatches) {
        try {
            // parse 'true' into `true`, 'false' into `false`, etc.
            simulateScratchDesktop = JSON.parse(scratchDesktopMatches[1]);
        } catch {
            // it's not JSON so just use the string
            // note that a typo like "falsy" will be treated as true
            simulateScratchDesktop = scratchDesktopMatches[1];
        }
    }

    if (process.env.NODE_ENV === 'production' && typeof window === 'object') {
        // Warn before navigating away
        window.onbeforeunload = () => true;
    }

    const root = ReactDomClient.createRoot(appTarget);

    // important: this is checking whether `simulateScratchDesktop` is truthy, not just defined!
    if (simulateScratchDesktop) {
        const WrappedGui = AppStateHOC(HashParserHOC(GUI));
        root.render(
            <WrappedGui
                canEditTitle
                platform={PLATFORM.DESKTOP}
                showTelemetryModal
                canSave={false}
                onTelemetryModalCancel={handleTelemetryModalCancel}
                onTelemetryModalOptIn={handleTelemetryModalOptIn}
                onTelemetryModalOptOut={handleTelemetryModalOptOut}
            />
        );
        return;
    }

    const WrappedGui = AppStateHOC(
        HashParserHOC(LocalProjectHOC(GUI)),
        false,
        localStorageConfigFactory
    );

    prepareInitialProject()
        .catch(err => log.error(err))
        .then(() => root.render(
            <WrappedGui
                canEditTitle
                canSave
                canCreateNew
                userOwnsProject
                backpackVisible
                showComingSoon={false}
                autoSaveIntervalSecs={60}
                backpackHost={backpackHost}
                onClickLogo={onClickLogo}
                onUpdateProjectId={updateProjectIdInHash}
            />
        ));
};
