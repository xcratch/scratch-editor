import {defineMessages, FormattedMessage, injectIntl} from 'react-intl';
import PropTypes from 'prop-types';
import React from 'react';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import intlShape from '../../lib/intlShape.js';

import styles from './save-version-modal.css';

const messages = defineMessages({
    title: {
        id: 'xcratch.saveVersionModal.title',
        defaultMessage: 'Save a version',
        description: 'Title of the modal for saving a project history version with a comment'
    },
    commentPlaceholder: {
        id: 'xcratch.projectLibrary.commentPlaceholder',
        defaultMessage: 'Write a comment…',
        description: 'Placeholder of the per-project comment field in the project list'
    }
});

const SaveVersionModalComponent = props => (
    <Modal
        className={styles.modalContent}
        contentLabel={props.intl.formatMessage(messages.title)}
        id="saveVersion"
        onRequestClose={props.onCancel}
    >
        <Box className={styles.body}>
            <Box>
                <textarea
                    autoFocus
                    className={styles.commentTextInput}
                    disabled={props.saving}
                    placeholder={props.intl.formatMessage(messages.commentPlaceholder)}
                    rows={4}
                    value={props.comment}
                    onChange={props.onChangeComment}
                />
            </Box>
            <Box className={styles.optionsRow}>
                <label>
                    <input
                        checked={props.isKeep}
                        disabled={props.saving}
                        type="checkbox"
                        onChange={props.onChangeKeep}
                    />
                    <FormattedMessage
                        defaultMessage="Lock this version to prevent deletion"
                        description="Checkbox label for locking a saved version to prevent deletion"
                        id="xcratch.saveVersionModal.keepLabel"
                    />
                </label>
            </Box>
            {props.error !== null && (
                <Box className={styles.errorMessage}>
                    <FormattedMessage
                        defaultMessage="Failed to save: {error}"
                        description="Error message shown when saving a project version fails"
                        id="xcratch.saveVersionModal.error"
                        values={{error: props.error}}
                    />
                </Box>
            )}
            <Box className={styles.buttonRow}>
                <button
                    className={styles.cancelButton}
                    disabled={props.saving}
                    onClick={props.onCancel}
                >
                    <FormattedMessage
                        defaultMessage="Cancel"
                        description="Button in prompt for cancelling the dialog"
                        id="gui.prompt.cancel"
                    />
                </button>
                <button
                    className={styles.saveButton}
                    disabled={props.saving}
                    onClick={props.onSave}
                >
                    {props.saving ? (
                        <FormattedMessage
                            defaultMessage="Saving…"
                            description="Button label shown while a project version is being saved"
                            id="xcratch.saveVersionModal.saving"
                        />
                    ) : (
                        <FormattedMessage
                            defaultMessage="Save"
                            description="Button label for saving a project version"
                            id="xcratch.saveVersionModal.save"
                        />
                    )}
                </button>
            </Box>
        </Box>
    </Modal>
);

SaveVersionModalComponent.propTypes = {
    comment: PropTypes.string.isRequired,
    error: PropTypes.string,
    intl: intlShape.isRequired,
    isKeep: PropTypes.bool.isRequired,
    onCancel: PropTypes.func.isRequired,
    onChangeComment: PropTypes.func.isRequired,
    onChangeKeep: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    saving: PropTypes.bool.isRequired
};

SaveVersionModalComponent.defaultProps = {
    error: null
};

export default injectIntl(SaveVersionModalComponent);
