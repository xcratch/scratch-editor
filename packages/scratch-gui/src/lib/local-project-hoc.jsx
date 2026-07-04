import bindAll from 'lodash.bindall';
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import VM from '@scratch/scratch-vm';

import log from './log.js';
import {
    LoadingState,
    getIsLoadingWithId,
    getIsShowingWithId,
    onLoadedProject,
    requestProjectUpload
} from '../reducers/project-state';
import {setProjectTitle} from '../reducers/project-title';
import {openLoadingProject, closeLoadingProject} from '../reducers/modals';
import {GUIStoragePropType} from '../gui-config';
import {isLocalProjectId} from './local-project-storage';

// This HOC sits outside the IntlProvider (which LocalizationHOC sets up
// inside the GUI), so the message is resolved from the redux locale state
// instead of react-intl. Translations live in local-project-translations.js.
const CONFLICT_MESSAGE_ID = 'xcratch.projectConflict.confirm';
const CONFLICT_MESSAGE_DEFAULT = 'This project has been updated in another tab.\n' +
    'OK: overwrite it with this tab\'s version\n' +
    'Cancel: discard this tab\'s changes and load the latest saved version';

// Resolves once the document is visible (immediately if it already is).
// Dialogs must never be shown from a hidden tab: browsers suppress them or
// auto-dismiss them (confirm() returns false), which would silently discard
// the user's work.
const waitUntilVisible = () => {
    if (typeof document !== 'object' || document.visibilityState === 'visible') {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
                resolve();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
    });
};

/* Higher Order Component that connects the GUI to the local (IndexedDB)
 * project storage:
 * - keeps the redux project title and the stored header name in sync
 *   (renaming alone does not mark a project as changed, so titles are
 *   persisted here rather than by the save flow)
 * - reflects the local project id into the URL via onUpdateProjectId
 * - intercepts saves (via ProjectSaverHOC's onUpdateProjectData seam) to
 *   detect multi-tab conflicts: when another tab has updated the project,
 *   the user chooses between overwriting and discarding this tab's changes
 *   (the latter reloads the latest saved version into the VM)
 * Mount only together with LocalProjectStorage (normal editor entry).
 * @param {React.Component} WrappedComponent: component to render
 * @returns {React.Component} component with local project behavior
 */
const LocalProjectHOC = function (WrappedComponent) {
    class LocalProjectComponent extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'handleUpdateProjectData',
                'handleUpdateProjectThumbnail'
            ]);
            // Set when the user chose to discard this tab's changes on a
            // conflict; consumed once the save flow settles back into
            // SHOWING_WITH_ID, which triggers the reload.
            this.discardReloadId = null;
            // While a discard is in flight, suppress thumbnail writes so the
            // other tab's thumbnail is not clobbered with our stale canvas.
            this.suppressThumbnailId = null;
        }
        componentDidMount () {
            this.props.storage.noteProjectTitle?.(this.props.reduxProjectTitle);
        }
        componentDidUpdate (prevProps) {
            if (this.props.reduxProjectTitle !== prevProps.reduxProjectTitle) {
                this.props.storage.noteProjectTitle?.(this.props.reduxProjectTitle);
                // Persist user renames (or upload-derived titles) of a local
                // project. Guard on an unchanged project id: a title change
                // that accompanies a project switch must not rename the
                // project that is still showing.
                if (this.props.isShowingWithId && prevProps.isShowingWithId &&
                    this.props.reduxProjectId === prevProps.reduxProjectId &&
                    isLocalProjectId(this.props.reduxProjectId)) {
                    this.props.storage.setProjectTitle?.(this.props.reduxProjectTitle);
                }
            }
            // Whenever a local project comes on screen, reflect its id via
            // onUpdateProjectId (URL hash). GUI only calls it when the id
            // changes, which misses e.g. version restores and .sb3 uploads
            // into the same project (their loading states clear the hash).
            if (this.props.isShowingWithId && !prevProps.isShowingWithId &&
                isLocalProjectId(this.props.reduxProjectId)) {
                this.props.onUpdateProjectId?.(this.props.reduxProjectId);
            }
            // When an existing local project finishes loading (open from list,
            // reload with #<id>), restore its stored name into redux; the
            // title in redux at this point is just the localized default.
            if (this.props.isShowingWithId && prevProps.isLoadingWithId &&
                isLocalProjectId(this.props.reduxProjectId) &&
                this.props.storage.getProjectHeader) {
                const titleAtFetch = this.props.reduxProjectTitle;
                this.props.storage.getProjectHeader(this.props.reduxProjectId).then(header => {
                    if (!header || !header.name) return;
                    // Don't clobber a rename that happened while we were reading
                    if (this.props.reduxProjectTitle !== titleAtFetch) return;
                    if (header.name !== this.props.reduxProjectTitle) {
                        this.props.onSetProjectTitle(header.name);
                    }
                });
            }
            // A conflict was resolved as "discard": once the aborted save
            // settles back into SHOWING_WITH_ID, reload the latest stored
            // version into the VM.
            if (this.discardReloadId && this.props.isShowingWithId && !prevProps.isShowingWithId) {
                const id = this.discardReloadId;
                this.discardReloadId = null;
                if (String(this.props.reduxProjectId) === id) {
                    this.reloadProjectFromStorage(id);
                } else {
                    this.suppressThumbnailId = null;
                }
            }
        }
        handleUpdateProjectData (projectId, vmState, params) {
            const storage = this.props.storage;
            if (!storage.hasConflict) {
                return storage.saveProject(projectId, vmState, params);
            }
            return storage.hasConflict(projectId).then(conflict => {
                if (!conflict) {
                    return storage.saveProject(projectId, vmState, params);
                }
                log.warn(`Local project conflict detected for project ${projectId}`);
                // An autosave can fire while the tab is in the background,
                // where browsers suppress or auto-dismiss confirm() (Chrome
                // returns false without showing anything, silently discarding
                // work). Hold the save until the tab is visible again, then
                // let the user decide.
                return waitUntilVisible().then(() => {
                    // eslint-disable-next-line no-alert
                    const overwrite = confirm(this.props.conflictMessage);
                    if (overwrite) {
                        return storage.saveProject(projectId, vmState, params);
                    }
                    // Discard: complete the save flow without writing anything;
                    // the reload is triggered from componentDidUpdate once the
                    // state machine is back in SHOWING_WITH_ID.
                    this.discardReloadId = String(projectId);
                    this.suppressThumbnailId = String(projectId);
                    return {id: projectId};
                });
            });
        }
        handleUpdateProjectThumbnail (projectId, thumbnail) {
            if (this.suppressThumbnailId === String(projectId)) return;
            this.props.storage.saveProjectThumbnail?.(projectId, thumbnail);
        }
        reloadProjectFromStorage (id) {
            this.props.storage.readProject(id)
                .then(project => {
                    if (!project) {
                        this.suppressThumbnailId = null;
                        return;
                    }
                    this.props.onLoadingStarted(this.props.loadingState);
                    const canSave = this.props.canSave !== false;
                    return this.props.vm.loadProject(project.body)
                        .then(() => {
                            if (project.name) this.props.onSetProjectTitle(project.name);
                            this.suppressThumbnailId = null;
                            this.props.onLoadingFinished(LoadingState.LOADING_VM_FILE_UPLOAD, canSave, true);
                        })
                        .catch(err => {
                            log.error(err);
                            this.suppressThumbnailId = null;
                            this.props.onLoadingFinished(LoadingState.LOADING_VM_FILE_UPLOAD, canSave, false);
                        });
                })
                .catch(err => {
                    this.suppressThumbnailId = null;
                    log.error(err);
                });
        }
        render () {
            const {
                conflictMessage: _conflictMessage,
                isLoadingWithId: _isLoadingWithId,
                isShowingWithId: _isShowingWithId,
                loadingState: _loadingState,
                onLoadingFinished: _onLoadingFinished,
                onLoadingStarted: _onLoadingStarted,
                onSetProjectTitle: _onSetProjectTitle,
                reduxProjectId: _reduxProjectId,
                reduxProjectTitle: _reduxProjectTitle,
                storage: _storage,
                vm: _vm,
                ...componentProps
            } = this.props;
            return (
                <WrappedComponent
                    onUpdateProjectData={this.handleUpdateProjectData}
                    onUpdateProjectThumbnail={this.handleUpdateProjectThumbnail}
                    {...componentProps}
                />
            );
        }
    }
    LocalProjectComponent.propTypes = {
        canSave: PropTypes.bool,
        conflictMessage: PropTypes.string,
        isLoadingWithId: PropTypes.bool,
        isShowingWithId: PropTypes.bool,
        loadingState: PropTypes.string,
        onLoadingFinished: PropTypes.func,
        onLoadingStarted: PropTypes.func,
        onSetProjectTitle: PropTypes.func,
        onUpdateProjectId: PropTypes.func,
        reduxProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        reduxProjectTitle: PropTypes.string,
        storage: GUIStoragePropType,
        vm: PropTypes.instanceOf(VM)
    };
    const mapStateToProps = state => {
        const loadingState = state.scratchGui.projectState.loadingState;
        return {
            conflictMessage: (state.locales.messages && state.locales.messages[CONFLICT_MESSAGE_ID]) ||
                CONFLICT_MESSAGE_DEFAULT,
            isLoadingWithId: getIsLoadingWithId(loadingState),
            isShowingWithId: getIsShowingWithId(loadingState),
            loadingState: loadingState,
            reduxProjectId: state.scratchGui.projectState.projectId,
            reduxProjectTitle: state.scratchGui.projectTitle,
            storage: state.scratchGui.config.storage,
            vm: state.scratchGui.vm
        };
    };
    const mapDispatchToProps = dispatch => ({
        onLoadingStarted: loadingState => {
            dispatch(requestProjectUpload(loadingState));
            dispatch(openLoadingProject());
        },
        onLoadingFinished: (loadingState, canSave, success) => {
            dispatch(onLoadedProject(loadingState, canSave, success));
            dispatch(closeLoadingProject());
        },
        onSetProjectTitle: title => dispatch(setProjectTitle(title))
    });
    return connect(
        mapStateToProps,
        mapDispatchToProps
    )(LocalProjectComponent);
};

export {
    LocalProjectHOC as default
};
