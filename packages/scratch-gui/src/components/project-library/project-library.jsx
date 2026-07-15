import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, FormattedMessage} from 'react-intl';
import intlShape from '../../lib/intlShape.js';

import Modal from '../../containers/modal.jsx';
import Spinner from '../spinner/spinner.jsx';
import ProjectItem from './project-item.jsx';
import VersionRow from './version-row.jsx';
import {computeGraphLayout} from '../../lib/git-graph.js';

import styles from './project-library.css';

const messages = defineMessages({
    libraryTitle: {
        id: 'xcratch.projectLibrary.title',
        defaultMessage: 'Projects in Browser',
        description: 'Heading for the project library modal listing projects saved in the browser'
    },
    commentPlaceholder: {
        id: 'xcratch.projectLibrary.commentPlaceholder',
        defaultMessage: 'Write a comment…',
        description: 'Placeholder of the per-project comment field in the project list'
    }
});

const ProjectLibraryComponent = props => {
    const {
        canManageVersions,
        canPlayVersion,
        canSeeInsideVersion,
        confirmRestoreTimestamp,
        currentProjectId,
        historyProjectName,
        intl,
        listAvailable,
        loading,
        onBackToList,
        onCancelRestore,
        onConfirmRestore,
        onCopyProject,
        onDeleteProject,
        onDeleteVersion,
        onOpenProject,
        onPlayVersion,
        onSeeInsideVersion,
        onRequestClose,
        onRestoreVersion,
        onSetComment,
        onSetVersionComment,
        onSetVersionKeep,
        onShowHistory,
        projects,
        versions,
        view
    } = props;

    const renderList = () => (
        <div className={styles.scrollGrid}>
            {loading ? (
                <div className={styles.spinnerWrapper}>
                    <Spinner
                        large
                        level="primary"
                    />
                </div>
            ) : (projects.length === 0 ? (
                <div className={styles.emptyMessage}>
                    <FormattedMessage
                        defaultMessage="No projects saved in this browser yet."
                        description="Message shown when the browser project list is empty"
                        id="xcratch.projectLibrary.empty"
                    />
                </div>
            ) : projects.map(project => (
                <ProjectItem
                    commentPlaceholder={intl.formatMessage(messages.commentPlaceholder)}
                    isCurrent={String(project.id) === String(currentProjectId)}
                    key={project.id}
                    project={project}
                    onCopy={onCopyProject}
                    onDelete={onDeleteProject}
                    onOpen={onOpenProject}
                    onSetComment={onSetComment}
                    onShowHistory={onShowHistory}
                />
            )))}
        </div>
    );

    const renderHistory = () => {
        const graphData = computeGraphLayout(versions);
        return (
            <div className={styles.historyContainer}>
                <div className={styles.historyHeader}>
                    {listAvailable ? (
                        <button
                            className={styles.itemButton}
                            onClick={onBackToList}
                        >
                            <FormattedMessage
                                defaultMessage="Back to list"
                                description="Button to go back from the version history to the project list"
                                id="xcratch.projectHistory.back"
                            />
                        </button>
                    ) : (
                        <button
                            className={styles.itemButton}
                            onClick={onRequestClose}
                        >
                            <FormattedMessage
                                defaultMessage="Close"
                                description="Button to close the history view when there is no project list to go back to (workshop mode)" // eslint-disable-line max-len
                                id="xcratch.projectHistory.close"
                            />
                        </button>
                    )}
                    <span className={styles.historyTitle}>
                        <FormattedMessage
                            defaultMessage="History of {projectName}"
                            description="Heading of the version history view"
                            id="xcratch.projectHistory.title"
                            values={{projectName: historyProjectName}}
                        />
                    </span>
                </div>
                <div className={styles.versionList}>
                    {versions.length === 0 ? (
                        <div className={styles.emptyMessage}>
                            <FormattedMessage
                                defaultMessage="No saved versions yet."
                                description="Message shown when a project has no version history"
                                id="xcratch.projectHistory.empty"
                            />
                        </div>
                    ) : versions.map((version, i) => (
                        <VersionRow
                            canManage={canManageVersions}
                            canPlay={canPlayVersion}
                            canSeeInside={canSeeInsideVersion}
                            comment={version.comment}
                            commentPlaceholder={intl.formatMessage(messages.commentPlaceholder)}
                            diff={version.diff}
                            graphInfo={graphData[i]}
                            isKeep={version.isKeep}
                            key={version.timestamp}
                            thumbnailUrl={version.thumbnailUrl}
                            timestamp={version.timestamp}
                            onDelete={onDeleteVersion}
                            onPlay={onPlayVersion}
                            onSeeInside={onSeeInsideVersion}
                            onRestore={onRestoreVersion}
                            onSetComment={onSetVersionComment}
                            onSetKeep={onSetVersionKeep}
                        />
                    ))}
                </div>
            </div>
        );
    };

    return (
        <Modal
            fullScreen
            contentLabel={intl.formatMessage(messages.libraryTitle)}
            id="projectLibrary"
            onRequestClose={onRequestClose}
        >
            {view === 'history' ? renderHistory() : renderList()}
            {confirmRestoreTimestamp && (
                <div className={styles.restoreDialogOverlay}>
                    <div className={styles.restoreDialog}>
                        <div className={styles.restoreDialogTitle}>
                            <FormattedMessage
                                defaultMessage="Restore this version?"
                                description="Title for version restore confirmation"
                                id="xcratch.projectHistory.restoreTitle"
                            />
                        </div>
                        <div className={styles.restoreDialogText}>
                            <FormattedMessage
                                defaultMessage="Do you want to save your current changes before restoring, or discard them?"
                                description="Body text for version restore confirmation"
                                id="xcratch.projectHistory.restorePrompt"
                            />
                        </div>
                        <div className={styles.restoreDialogButtons}>
                            <button
                                className={styles.restoreButtonSave}
                                onClick={() => onConfirmRestore(true)}
                            >
                                <FormattedMessage
                                    defaultMessage="Save current state and restore"
                                    description="Option to save current state before restoring"
                                    id="xcratch.projectHistory.restoreSave"
                                />
                            </button>
                            <button
                                className={styles.restoreButtonDiscard}
                                onClick={() => onConfirmRestore(false)}
                            >
                                <FormattedMessage
                                    defaultMessage="Discard current state and restore"
                                    description="Option to discard current state before restoring"
                                    id="xcratch.projectHistory.restoreDiscard"
                                />
                            </button>
                            <button
                                className={styles.restoreButtonCancel}
                                onClick={onCancelRestore}
                            >
                                <FormattedMessage
                                    defaultMessage="Cancel"
                                    description="Cancel restore"
                                    id="xcratch.projectHistory.restoreCancel"
                                />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    );
};

ProjectLibraryComponent.propTypes = {
    canManageVersions: PropTypes.bool,
    canPlayVersion: PropTypes.bool,
    canSeeInsideVersion: PropTypes.bool,
    confirmRestoreTimestamp: PropTypes.number,
    currentProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    historyProjectName: PropTypes.string,
    intl: intlShape.isRequired,
    listAvailable: PropTypes.bool,
    loading: PropTypes.bool,
    onBackToList: PropTypes.func.isRequired,
    onCancelRestore: PropTypes.func.isRequired,
    onConfirmRestore: PropTypes.func.isRequired,
    onCopyProject: PropTypes.func.isRequired,
    onDeleteProject: PropTypes.func.isRequired,
    onDeleteVersion: PropTypes.func.isRequired,
    onOpenProject: PropTypes.func.isRequired,
    onPlayVersion: PropTypes.func,
    onSeeInsideVersion: PropTypes.func,
    onRequestClose: PropTypes.func.isRequired,
    onRestoreVersion: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    onSetVersionComment: PropTypes.func.isRequired,
    onSetVersionKeep: PropTypes.func.isRequired,
    onShowHistory: PropTypes.func.isRequired,
    projects: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string,
        thumbnailUrl: PropTypes.string,
        modified: PropTypes.number,
        comment: PropTypes.string
    })).isRequired,
    versions: PropTypes.arrayOf(PropTypes.shape({
        comment: PropTypes.string,
        thumbnailUrl: PropTypes.string,
        timestamp: PropTypes.number.isRequired,
        isKeep: PropTypes.bool
    })).isRequired,
    view: PropTypes.oneOf(['list', 'history']).isRequired
};

ProjectLibraryComponent.defaultProps = {
    canManageVersions: true,
    canPlayVersion: false,
    canSeeInsideVersion: false,
    listAvailable: true
};

export default injectIntl(ProjectLibraryComponent);
