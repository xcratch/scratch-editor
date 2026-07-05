import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, FormattedMessage} from 'react-intl';
import intlShape from '../../lib/intlShape.js';

import Modal from '../../containers/modal.jsx';
import Spinner from '../spinner/spinner.jsx';
import ProjectItem from './project-item.jsx';
import VersionRow from './version-row.jsx';

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
        currentProjectId,
        historyProjectName,
        intl,
        loading,
        onBackToList,
        onCopyProject,
        onDeleteProject,
        onOpenProject,
        onRequestClose,
        onRestoreVersion,
        onSetComment,
        onSetVersionComment,
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

    const renderHistory = () => (
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
                ) : versions.map(version => (
                    <VersionRow
                        comment={version.comment}
                        commentPlaceholder={intl.formatMessage(messages.commentPlaceholder)}
                        key={version.timestamp}
                        thumbnailUrl={version.thumbnailUrl}
                        timestamp={version.timestamp}
                        onRestore={onRestoreVersion}
                        onSetComment={onSetVersionComment}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <Modal
            fullScreen
            contentLabel={intl.formatMessage(messages.libraryTitle)}
            id="projectLibrary"
            onRequestClose={onRequestClose}
        >
            {view === 'history' ? renderHistory() : renderList()}
        </Modal>
    );
};

ProjectLibraryComponent.propTypes = {
    currentProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    historyProjectName: PropTypes.string,
    intl: intlShape.isRequired,
    loading: PropTypes.bool,
    onBackToList: PropTypes.func.isRequired,
    onCopyProject: PropTypes.func.isRequired,
    onDeleteProject: PropTypes.func.isRequired,
    onOpenProject: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onRestoreVersion: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    onSetVersionComment: PropTypes.func.isRequired,
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
        timestamp: PropTypes.number.isRequired
    })).isRequired,
    view: PropTypes.oneOf(['list', 'history']).isRequired
};

export default injectIntl(ProjectLibraryComponent);
