import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage, FormattedDate, FormattedTime} from 'react-intl';

import styles from './project-library.css';

class ProjectItem extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClick',
            'handleClickCopy',
            'handleClickDelete',
            'handleClickHistory',
            'handleCommentBlur',
            'handleCommentClick',
            'handleCommentKeyDown'
        ]);
    }
    handleClick () {
        this.props.onOpen(this.props.project.id);
    }
    handleClickCopy (e) {
        e.stopPropagation();
        this.props.onCopy(this.props.project.id);
    }
    handleClickHistory (e) {
        e.stopPropagation();
        this.props.onShowHistory(this.props.project.id);
    }
    handleClickDelete (e) {
        e.stopPropagation();
        this.props.onDelete(this.props.project.id);
    }
    handleCommentClick (e) {
        // Clicking into the comment field must not open the project
        e.stopPropagation();
    }
    handleCommentBlur (e) {
        const comment = e.target.value;
        if (comment !== (this.props.project.comment || '')) {
            this.props.onSetComment(this.props.project.id, comment);
        }
    }
    handleCommentKeyDown (e) {
        // Keep keystrokes (incl. space/enter) inside the field; the card has
        // role="button" semantics around it
        e.stopPropagation();
    }
    render () {
        const {isCurrent, project} = this.props;
        return (
            <div
                className={classNames(styles.projectItem, {
                    [styles.current]: isCurrent
                })}
                role="button"
                tabIndex="0"
                onClick={this.handleClick}
            >
                {isCurrent && (
                    <div className={styles.currentBadge}>
                        <FormattedMessage
                            defaultMessage="Editing"
                            description="Badge on the project that is currently open in the editor"
                            id="xcratch.projectLibrary.current"
                        />
                    </div>
                )}
                <div className={styles.thumbnailContainer}>
                    {project.thumbnailUrl ? (
                        <img
                            className={styles.thumbnail}
                            draggable={false}
                            src={project.thumbnailUrl}
                        />
                    ) : (
                        <div className={styles.thumbnailPlaceholder} />
                    )}
                </div>
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.projectDate}>
                    <FormattedDate
                        day="2-digit"
                        month="short"
                        value={project.modified}
                        year="numeric"
                    />
                    {' '}
                    <FormattedTime value={project.modified} />
                </div>
                <textarea
                    className={styles.commentInput}
                    defaultValue={project.comment || ''}
                    key={`comment-${project.id}`}
                    placeholder={this.props.commentPlaceholder}
                    rows={2}
                    onBlur={this.handleCommentBlur}
                    onClick={this.handleCommentClick}
                    onKeyDown={this.handleCommentKeyDown}
                />
                <div className={styles.itemButtons}>
                    <button
                        className={styles.itemButton}
                        onClick={this.handleClickCopy}
                    >
                        <FormattedMessage
                            defaultMessage="Copy"
                            description="Button to duplicate a project in the browser storage"
                            id="xcratch.projectLibrary.copy"
                        />
                    </button>
                    <button
                        className={styles.itemButton}
                        onClick={this.handleClickHistory}
                    >
                        <FormattedMessage
                            defaultMessage="History"
                            description="Button to show the version history of a project"
                            id="xcratch.projectLibrary.history"
                        />
                    </button>
                    <button
                        className={classNames(styles.itemButton, styles.deleteButton)}
                        disabled={isCurrent}
                        onClick={this.handleClickDelete}
                    >
                        <FormattedMessage
                            defaultMessage="Delete"
                            description="Button to delete a project from the browser storage"
                            id="xcratch.projectLibrary.delete"
                        />
                    </button>
                </div>
            </div>
        );
    }
}

ProjectItem.propTypes = {
    commentPlaceholder: PropTypes.string,
    isCurrent: PropTypes.bool,
    onCopy: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    onShowHistory: PropTypes.func.isRequired,
    project: PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string,
        thumbnailUrl: PropTypes.string,
        modified: PropTypes.number,
        comment: PropTypes.string
    }).isRequired
};

export default ProjectItem;
