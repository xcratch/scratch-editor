import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl} from 'react-intl';
import {connect} from 'react-redux';
import VM from '@scratch/scratch-vm';

import intlShape from '../lib/intlShape.js';
import log from '../lib/log.js';
import {GUIStoragePropType} from '../gui-config';
import ProjectLibraryComponent from '../components/project-library/project-library.jsx';

import {
    LoadingState,
    onLoadedProject,
    requestProjectUpload,
    setProjectId
} from '../reducers/project-state';
import {
    closeProjectLibrary,
    openLoadingProject,
    closeLoadingProject
} from '../reducers/modals';

const messages = defineMessages({
    copyName: {
        id: 'xcratch.projectLibrary.copyName',
        defaultMessage: '{projectName} copy',
        description: 'Name given to the duplicate created from the project list'
    },
    deleteConfirm: {
        id: 'xcratch.projectLibrary.deleteConfirm',
        defaultMessage: 'Delete "{projectName}"? This cannot be undone.',
        description: 'Confirmation shown before deleting a project from browser storage'
    },
    openConfirm: {
        id: 'xcratch.projectLibrary.openConfirm',
        defaultMessage: 'There are unsaved changes in the current project. Open another project anyway?',
        description: 'Confirmation shown when opening another project while there are unsaved changes'
    },
    restoreConfirm: {
        id: 'xcratch.projectHistory.restoreConfirm',
        defaultMessage: 'Restore this version? The current state is saved to the history first.',
        description: 'Confirmation shown before restoring a project version'
    }
});

class ProjectLibrary extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleBackToList',
            'handleCopyProject',
            'handleDeleteProject',
            'handleOpenProject',
            'handleRestoreVersion',
            'handleSetComment',
            'handleShowHistory'
        ]);
        this.state = {
            loading: true,
            projects: [],
            view: 'list',
            historyProjectId: null,
            versions: []
        };
        this.objectUrls = [];
        this.versionObjectUrls = [];
    }
    componentDidMount () {
        this.loadProjects();
    }
    componentWillUnmount () {
        this.revokeObjectUrls();
        this.revokeVersionObjectUrls();
    }
    revokeObjectUrls () {
        this.objectUrls.forEach(url => URL.revokeObjectURL(url));
        this.objectUrls = [];
    }
    revokeVersionObjectUrls () {
        this.versionObjectUrls.forEach(url => URL.revokeObjectURL(url));
        this.versionObjectUrls = [];
    }
    loadProjects () {
        this.setState({loading: true});
        return this.props.storage.listProjects()
            .then(headers => {
                this.revokeObjectUrls();
                const projects = headers.map(header => {
                    let thumbnailUrl = null;
                    if (header.thumbnail) {
                        thumbnailUrl = URL.createObjectURL(header.thumbnail);
                        this.objectUrls.push(thumbnailUrl);
                    }
                    return {
                        id: header.id,
                        name: header.name,
                        thumbnailUrl,
                        modified: header.modified,
                        comment: header.comment || ''
                    };
                });
                this.setState({loading: false, projects});
            })
            .catch(err => {
                log.error(err);
                this.setState({loading: false, projects: []});
            });
    }
    handleOpenProject (id) {
        if (String(id) === String(this.props.reduxProjectId)) {
            this.props.onRequestClose();
            return;
        }
        if (this.props.projectChanged) {
            // eslint-disable-next-line no-alert
            const readyToReplace = confirm(this.props.intl.formatMessage(messages.openConfirm));
            if (!readyToReplace) return;
        }
        // Note: don't dispatch setProjectTitle here — while the previous
        // project is still showing, a title change would be persisted onto
        // its header. LocalProjectHOC restores the title after loading.
        this.props.onSetProjectId(id);
        this.props.onRequestClose();
    }
    handleCopyProject (id) {
        const project = this.state.projects.find(p => p.id === id);
        const copyName = this.props.intl.formatMessage(
            messages.copyName, {projectName: project ? project.name : id});
        this.props.storage.duplicateProject(id, copyName)
            .then(() => this.loadProjects())
            .catch(err => log.error(err));
    }
    handleSetComment (id, comment) {
        this.props.storage.setProjectComment(id, comment)
            .then(() => {
                // Keep local state in sync without reloading the whole list
                this.setState(prevState => ({
                    projects: prevState.projects.map(project =>
                        (project.id === id ? {...project, comment} : project))
                }));
            })
            .catch(err => log.error(err));
    }
    handleDeleteProject (id) {
        const project = this.state.projects.find(p => p.id === id);
        // eslint-disable-next-line no-alert
        const readyToDelete = confirm(this.props.intl.formatMessage(
            messages.deleteConfirm, {projectName: project ? project.name : id}));
        if (!readyToDelete) return;
        this.props.storage.deleteProject(id)
            .then(() => this.loadProjects())
            .catch(err => log.error(err));
    }
    handleShowHistory (id) {
        this.props.storage.listVersions(id)
            .then(versions => {
                this.revokeVersionObjectUrls();
                const versionItems = versions.map(version => {
                    let thumbnailUrl = null;
                    if (version.thumbnail) {
                        thumbnailUrl = URL.createObjectURL(version.thumbnail);
                        this.versionObjectUrls.push(thumbnailUrl);
                    }
                    return {timestamp: version.timestamp, thumbnailUrl};
                });
                this.setState({
                    view: 'history',
                    historyProjectId: id,
                    versions: versionItems
                });
            })
            .catch(err => log.error(err));
    }
    handleBackToList () {
        this.revokeVersionObjectUrls();
        this.setState({view: 'list', historyProjectId: null, versions: []});
    }
    handleRestoreVersion (timestamp) {
        // eslint-disable-next-line no-alert
        const readyToRestore = confirm(this.props.intl.formatMessage(messages.restoreConfirm));
        if (!readyToRestore) return;
        const id = this.state.historyProjectId;
        this.props.storage.restoreVersion(id, timestamp)
            .then(body => {
                if (String(id) === String(this.props.reduxProjectId)) {
                    // The project is open: setProjectId would not refetch the
                    // same id, so load the restored body into the VM directly,
                    // following the sb-file-uploader loading-state sequence.
                    this.props.onLoadingStarted(this.props.loadingState);
                    this.props.onRequestClose();
                    let loadingSuccess = false;
                    return this.props.vm.loadProject(body)
                        .then(() => {
                            loadingSuccess = true;
                        })
                        .catch(err => {
                            log.error(err);
                        })
                        .then(() => {
                            this.props.onLoadingFinished(
                                LoadingState.LOADING_VM_FILE_UPLOAD, this.props.canSave, loadingSuccess);
                        });
                }
                this.props.onSetProjectId(id);
                this.props.onRequestClose();
            })
            .catch(err => log.error(err));
    }
    render () {
        const project = this.state.historyProjectId === null ?
            null :
            this.state.projects.find(p => p.id === this.state.historyProjectId);
        return (
            <ProjectLibraryComponent
                currentProjectId={this.props.reduxProjectId}
                historyProjectName={project ? project.name : ''}
                loading={this.state.loading}
                projects={this.state.projects}
                versions={this.state.versions}
                view={this.state.view}
                onBackToList={this.handleBackToList}
                onCopyProject={this.handleCopyProject}
                onDeleteProject={this.handleDeleteProject}
                onOpenProject={this.handleOpenProject}
                onSetComment={this.handleSetComment}
                onRequestClose={this.props.onRequestClose}
                onRestoreVersion={this.handleRestoreVersion}
                onShowHistory={this.handleShowHistory}
            />
        );
    }
}

ProjectLibrary.propTypes = {
    canSave: PropTypes.bool,
    intl: intlShape.isRequired,
    loadingState: PropTypes.string,
    onLoadingFinished: PropTypes.func.isRequired,
    onLoadingStarted: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onSetProjectId: PropTypes.func.isRequired,
    projectChanged: PropTypes.bool,
    reduxProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    storage: GUIStoragePropType.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    loadingState: state.scratchGui.projectState.loadingState,
    projectChanged: state.scratchGui.projectChanged,
    reduxProjectId: state.scratchGui.projectState.projectId,
    storage: state.scratchGui.config.storage,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onLoadingStarted: loadingState => {
        dispatch(requestProjectUpload(loadingState));
        dispatch(openLoadingProject());
    },
    onLoadingFinished: (loadingState, canSave, success) => {
        dispatch(onLoadedProject(loadingState, canSave, success));
        dispatch(closeLoadingProject());
    },
    onRequestClose: () => dispatch(closeProjectLibrary()),
    onSetProjectId: id => dispatch(setProjectId(id))
});

// Allow incoming props (e.g. onRequestClose from gui.jsx) to override redux-provided props
const mergeProps = (stateProps, dispatchProps, ownProps) => Object.assign(
    {}, stateProps, dispatchProps, ownProps
);

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps,
    mergeProps
)(ProjectLibrary));
