import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage, FormattedDate, FormattedTime} from 'react-intl';

import styles from './project-library.css';

class VersionRow extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClickRestore',
            'handleCommentBlur',
            'handleCommentClick',
            'handleCommentKeyDown'
        ]);
    }
    handleClickRestore () {
        this.props.onRestore(this.props.timestamp);
    }
    handleCommentClick (e) {
        e.stopPropagation();
    }
    handleCommentBlur (e) {
        const comment = e.target.value;
        if (comment !== (this.props.comment || '')) {
            this.props.onSetComment(this.props.timestamp, comment);
        }
    }
    handleCommentKeyDown (e) {
        e.stopPropagation();
    }
    render () {
        return (
            <div className={styles.versionRow}>
                <span className={styles.versionInfo}>
                    <span className={styles.versionThumbnailContainer}>
                        {this.props.thumbnailUrl ? (
                            <img
                                className={styles.versionThumbnail}
                                draggable={false}
                                src={this.props.thumbnailUrl}
                            />
                        ) : (
                            <span className={styles.versionThumbnailPlaceholder} />
                        )}
                    </span>
                    <span className={styles.versionDate}>
                        <FormattedDate
                            day="2-digit"
                            month="short"
                            value={this.props.timestamp}
                            year="numeric"
                        />
                        <FormattedTime
                            hour="2-digit"
                            minute="2-digit"
                            second="2-digit"
                            value={this.props.timestamp}
                        />
                    </span>
                </span>
                <textarea
                    className={styles.versionCommentInput}
                    defaultValue={this.props.comment || ''}
                    key={`vcomment-${this.props.timestamp}`}
                    placeholder={this.props.commentPlaceholder}
                    rows={1}
                    onBlur={this.handleCommentBlur}
                    onClick={this.handleCommentClick}
                    onKeyDown={this.handleCommentKeyDown}
                />
                <button
                    className={styles.itemButton}
                    onClick={this.handleClickRestore}
                >
                    <FormattedMessage
                        defaultMessage="Restore this version"
                        description="Button to restore a project to this version"
                        id="xcratch.projectHistory.restore"
                    />
                </button>
            </div>
        );
    }
}

VersionRow.propTypes = {
    comment: PropTypes.string,
    commentPlaceholder: PropTypes.string,
    onRestore: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    thumbnailUrl: PropTypes.string,
    timestamp: PropTypes.number.isRequired
};

export default VersionRow;
