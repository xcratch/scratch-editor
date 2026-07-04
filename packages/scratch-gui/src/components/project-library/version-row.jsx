import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage, FormattedDate, FormattedTime} from 'react-intl';

import styles from './project-library.css';

class VersionRow extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleClickRestore']);
    }
    handleClickRestore () {
        this.props.onRestore(this.props.timestamp);
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
    onRestore: PropTypes.func.isRequired,
    thumbnailUrl: PropTypes.string,
    timestamp: PropTypes.number.isRequired
};

export default VersionRow;
