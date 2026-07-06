import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage, FormattedDate, FormattedTime, injectIntl, defineMessages} from 'react-intl';

import intlShape from '../../lib/intlShape.js';
import styles from './project-library.css';

const messages = defineMessages({
    lockTooltip: {
        id: 'xcratch.projectHistory.lock',
        defaultMessage: 'Lock this version to prevent deletion',
        description: 'Tooltip for lock button'
    },
    unlockTooltip: {
        id: 'xcratch.projectHistory.unlock',
        defaultMessage: 'Unlock this version',
        description: 'Tooltip for unlock button'
    }
});

class VersionRow extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClickRestore',
            'handleClickDelete',
            'handleCommentBlur',
            'handleCommentClick',
            'handleCommentKeyDown',
            'handleClickKeep'
        ]);
    }
    handleClickKeep () {
        this.props.onSetKeep(this.props.timestamp, !this.props.isKeep);
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
        const titleText = this.props.intl.formatMessage(
            this.props.isKeep ? messages.unlockTooltip : messages.lockTooltip
        );

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
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
                        {this.props.diff && (
                            <div className={styles.versionDiffContainer}>
                                {this.props.diff.code && (
                                    <span className={`${styles.diffBadge} ${styles.diffBadgeCode}`}>
                                        <FormattedMessage defaultMessage="Code" description="Code changed" id="xcratch.projectHistory.diffCode" />
                                    </span>
                                )}
                                {this.props.diff.assets && (
                                    <span className={`${styles.diffBadge} ${styles.diffBadgeAssets}`}>
                                        <FormattedMessage defaultMessage="Assets" description="Assets changed" id="xcratch.projectHistory.diffAssets" />
                                    </span>
                                )}
                                {this.props.diff.sprites !== 0 && (
                                    <span className={`${styles.diffBadge} ${styles.diffBadgeSprites}`}>
                                        {this.props.diff.sprites > 0 ? `+${this.props.diff.sprites}` : this.props.diff.sprites}
                                        {' '}<FormattedMessage defaultMessage="Sprites" description="Sprites changed" id="xcratch.projectHistory.diffSprites" />
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
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
                        onClick={this.handleClickKeep}
                        title={titleText}
                        style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.4rem'}}
                    >
                        {this.props.isKeep ? (
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.5}}>
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                            </svg>
                        )}
                    </button>
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
                        disabled={this.props.isKeep}
                        style={this.props.isKeep ? {opacity: 0.5, cursor: 'not-allowed'} : {}}
                        onClick={this.props.isKeep ? undefined : this.handleClickDelete}
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
    diff: PropTypes.object,
    graphInfo: PropTypes.object,
    intl: intlShape.isRequired,
    isKeep: PropTypes.bool,
    onDelete: PropTypes.func.isRequired,
    onRestore: PropTypes.func.isRequired,
    onSetComment: PropTypes.func.isRequired,
    onSetKeep: PropTypes.func.isRequired,
    thumbnailUrl: PropTypes.string,
    timestamp: PropTypes.number.isRequired
};

export default injectIntl(VersionRow);
