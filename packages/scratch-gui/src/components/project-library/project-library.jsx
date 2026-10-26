import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, FormattedMessage} from 'react-intl';
import intlShape from '../../lib/intlShape.js';

import Modal from '../../containers/modal.jsx';
import Spinner from '../spinner/spinner.jsx';
import ProjectItem from './project-item.jsx';
import VersionRow from './version-row.jsx';
import {computeGraphLayout} from '../../lib/git-graph.js';
import {SORT_ORDERS, filterAndSortProjects, formatBytes} from '../../lib/project-list-filter.js';

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
    },
    searchPlaceholder: {
        id: 'xcratch.projectLibrary.searchPlaceholder',
        defaultMessage: 'Search by name or comment',
        description: 'Placeholder of the search field in the project list'
    },
    sortLabel: {
        id: 'xcratch.projectLibrary.sortLabel',
        defaultMessage: 'Sort by',
        description: 'Accessible label of the sort order selector in the project list'
    },
    sortModified: {
        id: 'xcratch.projectLibrary.sortModified',
        defaultMessage: 'Last modified',
        description: 'Sort option: most recently modified first'
    },
    sortCreated: {
        id: 'xcratch.projectLibrary.sortCreated',
        defaultMessage: 'Date created',
        description: 'Sort option: most recently created first'
    },
    sortName: {
        id: 'xcratch.projectLibrary.sortName',
        defaultMessage: 'Name',
        description: 'Sort option: alphabetical by project name'
    },
    sortSize: {
        id: 'xcratch.projectLibrary.sortSize',
        defaultMessage: 'Size',
        description: 'Sort option: largest projects first'
    },
    exportTitle: {
        id: 'xcratch.projectLibrary.exportTitle',
        defaultMessage: 'Save the listed projects with their history to a file',
        description: 'Tooltip of the backup button in the project list'
    },
    importTitle: {
        id: 'xcratch.projectLibrary.importTitle',
        defaultMessage: 'Add the projects in a backup file to this browser',
        description: 'Tooltip of the restore button in the project list'
    }
});

const sortMessages = {
    modified: messages.sortModified,
    created: messages.sortCreated,
    name: messages.sortName,
    size: messages.sortSize
};

const ProjectLibraryComponent = props => {
    const {
        backupBusy,
        canBackup,
        canPruneVersions,
        confirmRestoreTimestamp,
        currentProjectId,
        historyProjectName,
        intl,
        loading,
        onBackToList,
        onCancelRestore,
        onConfirmRestore,
        onCopyProject,
        onDeleteProject,
        onDeleteVersion,
        onExportProjects,
        onImportProjects,
        onOpenProject,
        onPruneVersions,
        onRequestClose,
        onRestoreVersion,
        onSetComment,
        onSetVersionComment,
        onSetVersionKeep,
        onSearchChange,
        onShowHistory,
        onSortChange,
        projects,
        searchQuery,
        sortOrder,
        usage,
        versions,
        view
    } = props;

    const renderToolbar = visibleProjects => (
        <div className={styles.listToolbar}>
            <input
                className={styles.searchInput}
                placeholder={intl.formatMessage(messages.searchPlaceholder)}
                type="search"
                value={searchQuery}
                onChange={onSearchChange}
            />
            <select
                aria-label={intl.formatMessage(messages.sortLabel)}
                className={styles.sortSelect}
                value={sortOrder}
                onChange={onSortChange}
            >
                {SORT_ORDERS.map(order => (
                    <option
                        disabled={order === 'size' && !usage}
                        key={order}
                        value={order}
                    >
                        {intl.formatMessage(sortMessages[order])}
                    </option>
                ))}
            </select>
            {usage && (
                <span className={styles.usageSummary}>
                    {usage.quota ? (
                        <FormattedMessage
                            defaultMessage="{used} used (browser quota {quota})"
                            description="Total size of projects saved in the browser, with the browser storage quota"
                            id="xcratch.projectLibrary.usageWithQuota"
                            values={{
                                used: formatBytes(usage.totalBytes),
                                quota: formatBytes(usage.quota.quota)
                            }}
                        />
                    ) : (
                        <FormattedMessage
                            defaultMessage="{used} used"
                            description="Total size of projects saved in the browser"
                            id="xcratch.projectLibrary.usage"
                            values={{used: formatBytes(usage.totalBytes)}}
                        />
                    )}
                </span>
            )}
            {canBackup && (
                <div className={styles.backupButtons}>
                    <button
                        className={styles.itemButton}
                        disabled={backupBusy || visibleProjects.length === 0}
                        title={intl.formatMessage(messages.exportTitle)}
                        onClick={onExportProjects}
                    >
                        <FormattedMessage
                            defaultMessage="Back up"
                            description="Button to save the listed projects with their history to a backup file"
                            id="xcratch.projectLibrary.export"
                        />
                    </button>
                    <label
                        className={classNames(styles.itemButton, {[styles.disabled]: backupBusy})}
                        title={intl.formatMessage(messages.importTitle)}
                    >
                        <FormattedMessage
                            defaultMessage="Restore"
                            description="Button to restore projects from a backup file"
                            id="xcratch.projectLibrary.import"
                        />
                        <input
                            accept=".zip,application/zip"
                            className={styles.fileInput}
                            disabled={backupBusy}
                            type="file"
                            onChange={onImportProjects}
                        />
                    </label>
                </div>
            )}
        </div>
    );

    const renderGrid = visibleProjects => (
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
            ) : (visibleProjects.length === 0 ? (
                <div className={styles.emptyMessage}>
                    <FormattedMessage
                        defaultMessage="No projects match your search."
                        description="Message shown when no project in the browser list matches the search"
                        id="xcratch.projectLibrary.noMatch"
                    />
                </div>
            ) : visibleProjects.map(project => (
                <ProjectItem
                    commentPlaceholder={intl.formatMessage(messages.commentPlaceholder)}
                    isCurrent={String(project.id) === String(currentProjectId)}
                    key={project.id}
                    project={project}
                    usage={usage ? usage.projects[project.id] : null}
                    onCopy={onCopyProject}
                    onDelete={onDeleteProject}
                    onOpen={onOpenProject}
                    onSetComment={onSetComment}
                    onShowHistory={onShowHistory}
                />
            ))))}
        </div>
    );

    const renderList = () => {
        const visibleProjects = filterAndSortProjects(projects, {query: searchQuery, sortOrder, usage});
        return (
            <div className={styles.listContainer}>
                {renderToolbar(visibleProjects)}
                {renderGrid(visibleProjects)}
            </div>
        );
    };

    const renderHistory = () => {
        const graphData = computeGraphLayout(versions);
        return (
        <div className={styles.historyContainer}>
            <div className={styles.historyHeader}>
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
                <span className={styles.historyTitle}>
                    <FormattedMessage
                        defaultMessage="History of {projectName}"
                        description="Heading of the version history view"
                        id="xcratch.projectHistory.title"
                        values={{projectName: historyProjectName}}
                    />
                </span>
                {canPruneVersions && versions.length > 1 && (
                    <button
                        className={classNames(styles.itemButton, styles.pruneButton)}
                        onClick={onPruneVersions}
                    >
                        <FormattedMessage
                            defaultMessage="Clean up history"
                            description="Button to delete every version except the latest, kept and commented ones" // eslint-disable-line max-len
                            id="xcratch.projectHistory.prune"
                        />
                    </button>
                )}
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
                        comment={version.comment}
                        commentPlaceholder={intl.formatMessage(messages.commentPlaceholder)}
                        diff={version.diff}
                        graphInfo={graphData[i]}
                        isKeep={version.isKeep}
                        key={version.timestamp}
                        thumbnailUrl={version.thumbnailUrl}
                        timestamp={version.timestamp}
                        onDelete={onDeleteVersion}
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
    backupBusy: PropTypes.bool,
    canBackup: PropTypes.bool,
    canPruneVersions: PropTypes.bool,
    confirmRestoreTimestamp: PropTypes.number,
    currentProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    historyProjectName: PropTypes.string,
    intl: intlShape.isRequired,
    loading: PropTypes.bool,
    onBackToList: PropTypes.func.isRequired,
    onCancelRestore: PropTypes.func.isRequired,
    onConfirmRestore: PropTypes.func.isRequired,
    onCopyProject: PropTypes.func.isRequired,
    onDeleteProject: PropTypes.func.isRequired,
    onDeleteVersion: PropTypes.func.isRequired,
    onExportProjects: PropTypes.func,
    onImportProjects: PropTypes.func,
    onOpenProject: PropTypes.func.isRequired,
    onPruneVersions: PropTypes.func,
    onRequestClose: PropTypes.func.isRequired,
    onRestoreVersion: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    onSetVersionComment: PropTypes.func.isRequired,
    onSetVersionKeep: PropTypes.func.isRequired,
    onSearchChange: PropTypes.func.isRequired,
    onShowHistory: PropTypes.func.isRequired,
    onSortChange: PropTypes.func.isRequired,
    projects: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string,
        thumbnailUrl: PropTypes.string,
        created: PropTypes.number,
        modified: PropTypes.number,
        comment: PropTypes.string
    })).isRequired,
    searchQuery: PropTypes.string,
    sortOrder: PropTypes.oneOf(SORT_ORDERS),
    usage: PropTypes.shape({
        projects: PropTypes.objectOf(PropTypes.shape({
            bytes: PropTypes.number,
            versionCount: PropTypes.number
        })),
        totalBytes: PropTypes.number,
        quota: PropTypes.shape({
            usage: PropTypes.number,
            quota: PropTypes.number
        })
    }),
    versions: PropTypes.arrayOf(PropTypes.shape({
        comment: PropTypes.string,
        thumbnailUrl: PropTypes.string,
        timestamp: PropTypes.number.isRequired,
        isKeep: PropTypes.bool
    })).isRequired,
    view: PropTypes.oneOf(['list', 'history']).isRequired
};

ProjectLibraryComponent.defaultProps = {
    backupBusy: false,
    canBackup: false,
    canPruneVersions: false,
    searchQuery: '',
    sortOrder: 'modified',
    usage: null
};

export default injectIntl(ProjectLibraryComponent);
