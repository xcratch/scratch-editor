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
            'handleClickDelete',
            'handleCommentBlur',
            'handleCommentClick',
            'handleCommentKeyDown'
        ]);
    }
    handleClickRestore () {
        this.props.onRestore(this.props.timestamp);
    }
    handleClickDelete () {
        this.props.onDelete(this.props.timestamp);
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
        let svgWidth = 40;
        if (this.props.graphInfo) {
            const maxCol = Math.max(
                this.props.graphInfo.nodeColumn,
                ...this.props.graphInfo.passingLines.map(p => p.col),
                ...this.props.graphInfo.incomingLines.map(l => l.fromCol)
            );
            svgWidth = (maxCol + 1) * 20;
        }

        return (
            <div className={styles.versionRow}>
                {this.props.graphInfo && (
                    <div className={styles.gitGraphContainer} style={{ width: svgWidth }}>
                        <svg width={svgWidth} height="100%" className={styles.gitGraphSvg}>
                            {this.props.graphInfo.passingLines.map(line => (
                                <line key={`pass-${line.col}`} x1={line.col * 20 + 10} y1="0" x2={line.col * 20 + 10} y2="100%" stroke={line.color} strokeWidth="2" />
                            ))}
                            {this.props.graphInfo.incomingLines.map(line => (
                                <path key={`inc-${line.fromCol}`} d={`M ${line.fromCol * 20 + 10} 0 C ${line.fromCol * 20 + 10} 20, ${this.props.graphInfo.nodeColumn * 20 + 10} 20, ${this.props.graphInfo.nodeColumn * 20 + 10} 30`} stroke={line.color} strokeWidth="2" fill="none" />
                            ))}
                            {this.props.graphInfo.outgoingLines.map(line => (
                                <line key={`out-${line.fromCol}`} x1={line.fromCol * 20 + 10} y1="30" x2={line.toCol * 20 + 10} y2="100%" stroke={line.color} strokeWidth="2" />
                            ))}
                            <circle cx={this.props.graphInfo.nodeColumn * 20 + 10} cy="30" r="5" fill={this.props.graphInfo.nodeColor} />
                        </svg>
                    </div>
                )}
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
                <div className={styles.versionActions}>
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
                    <button
                        className={styles.deleteVersionButton}
                        onClick={this.handleClickDelete}
                    >
                        <FormattedMessage
                            defaultMessage="Delete"
                            description="Button to delete a version"
                            id="xcratch.projectHistory.deleteVersion"
                        />
                    </button>
                </div>
            </div>
        );
    }
}

VersionRow.propTypes = {
    comment: PropTypes.string,
    commentPlaceholder: PropTypes.string,
    graphInfo: PropTypes.object,
    onDelete: PropTypes.func.isRequired,
    onRestore: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    thumbnailUrl: PropTypes.string,
    timestamp: PropTypes.number.isRequired
};

export default VersionRow;
