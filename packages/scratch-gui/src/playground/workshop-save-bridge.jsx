import {useEffect} from 'react';
import {useStore} from 'react-redux';
import PropTypes from 'prop-types';

import {
    getIsAnyCreatingNewState,
    getIsShowingWithId,
    getIsUpdating,
    manualUpdateProject
} from '../reducers/project-state';

const REQUEST_TYPE = 'xcratch-workshop:save-request';
const ACK_TYPE = 'xcratch-workshop:save-ack';
const RESULT_TYPE = 'xcratch-workshop:save-result';

/**
 * Lets the embedding workshop page ask the editor to flush unsaved changes
 * (see the postMessage protocol in render-workshop-gui.jsx). Renders nothing.
 * Must be mounted inside the redux Provider.
 * @param {object} props - component props
 * @param {boolean} props.canSave - whether this editor instance may save at all
 * @returns {null} nothing is rendered
 */
const WorkshopSaveBridge = ({canSave}) => {
    const store = useStore();

    useEffect(() => {
        const unsubscribers = new Set();
        let disposed = false;

        const readState = () => {
            const state = store.getState().scratchGui;
            return {
                changed: state.projectChanged,
                loadingState: state.projectState.loadingState,
                alertsList: state.alerts.alertsList
            };
        };

        // projectChanged alone cannot tell us whether the last save failed: after a failed
        // save the loading state returns to SHOWING_WITH_ID, and ProjectFetcherHOC then
        // resets projectChanged to false although nothing was stored. projectState.error
        // doesn't help either (an HTTP failure stores the bare status code, so two failures
        // in a row look identical). Instead, watch every save (manual or auto) for the whole
        // lifetime of the editor: updateProjectToStorage shows the 'saving' alert (which
        // clears 'savingError') when it starts, and on failure shows 'savingError' before
        // leaving the updating state. So 'savingError' being present when updating ends
        // means that save failed; remember it until a later save succeeds.
        let lastSaveFailed = false;
        let wasUpdating = getIsUpdating(readState().loadingState);
        const trackSaves = () => {
            const {loadingState, alertsList} = readState();
            const updating = getIsUpdating(loadingState);
            if (!updating && wasUpdating) {
                lastSaveFailed = alertsList.some(alert => alert.alertId === 'savingError');
            }
            wasUpdating = updating;
        };
        const unsubscribeTracking = store.subscribe(trackSaves);

        // Resolve once predicate() holds (checked immediately, then on every store update).
        const waitUntil = predicate => new Promise(resolve => {
            if (predicate()) {
                resolve();
                return;
            }
            let unsubscribe = null;
            const check = () => {
                if (!predicate()) return;
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribers.delete(unsubscribe);
                }
                resolve();
            };
            unsubscribe = store.subscribe(check);
            unsubscribers.add(unsubscribe);
        });

        const isBusy = () => {
            const {loadingState} = readState();
            return getIsUpdating(loadingState) || getIsAnyCreatingNewState(loadingState);
        };

        const save = async () => {
            if (!canSave) return {ok: true, saved: false};

            // An in-flight save/create must finish before we can judge what is unsaved.
            await waitUntil(() => !isBusy());

            const {changed, loadingState} = readState();
            // A previously failed save leaves changes unstored even if projectChanged was reset.
            if (!changed && !lastSaveFailed) return {ok: true, saved: false};
            if (!getIsShowingWithId(loadingState)) return {ok: false, saved: false};

            store.dispatch(manualUpdateProject());
            // The reducer enters MANUAL_UPDATING synchronously (trackSaves has seen the
            // start); if it did not, nothing was saved.
            if (!isBusy()) return {ok: false, saved: false};
            await waitUntil(() => !isBusy());
            // On failure the savingError alert is shown and lastSaveFailed is set.
            return {ok: !lastSaveFailed && !readState().changed, saved: true};
        };

        const onMessage = event => {
            if (event.source !== window.parent || window.parent === window) return;
            const data = event.data;
            if (!data || data.type !== REQUEST_TYPE) return;
            const requestId = data.requestId;

            window.parent.postMessage({type: ACK_TYPE, requestId}, '*');
            save()
                .catch(() => ({ok: false, saved: false}))
                .then(({ok, saved}) => {
                    if (disposed) return;
                    window.parent.postMessage({type: RESULT_TYPE, requestId, ok, saved}, '*');
                });
        };

        window.addEventListener('message', onMessage);
        return () => {
            disposed = true;
            window.removeEventListener('message', onMessage);
            unsubscribeTracking();
            unsubscribers.forEach(unsubscribe => unsubscribe());
            unsubscribers.clear();
        };
    }, [store, canSave]);

    return null;
};

WorkshopSaveBridge.propTypes = {
    canSave: PropTypes.bool
};

export default WorkshopSaveBridge;
