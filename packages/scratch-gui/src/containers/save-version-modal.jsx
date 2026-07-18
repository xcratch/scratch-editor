import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from '@scratch/scratch-vm';

import log from '../lib/log.js';
import SaveVersionModalComponent from '../components/save-version-modal/save-version-modal.jsx';

import {showAlertWithTimeout} from '../reducers/alerts';
import {closeSaveVersionModal} from '../reducers/modals';

class SaveVersionModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChangeComment',
            'handleChangeKeep',
            'handleCancel',
            'handleSave'
        ]);
        this.state = {
            comment: '',
            isKeep: false,
            saving: false,
            error: null
        };
    }
    handleChangeComment (e) {
        this.setState({comment: e.target.value});
    }
    handleChangeKeep (e) {
        this.setState({isKeep: e.target.checked});
    }
    handleCancel () {
        if (this.state.saving) return;
        this.props.onRequestClose();
    }
    handleSave () {
        this.setState({saving: true, error: null});
        this.props.vm.runtime.saveProjectVersion(this.state.comment, this.state.isKeep)
            .then(() => {
                this.props.onSaveSuccess();
                this.props.onRequestClose();
            })
            .catch(err => {
                log.error(err);
                this.setState({saving: false, error: err.message || String(err)});
            });
    }
    render () {
        return (
            <SaveVersionModalComponent
                comment={this.state.comment}
                error={this.state.error}
                isKeep={this.state.isKeep}
                saving={this.state.saving}
                onCancel={this.handleCancel}
                onChangeComment={this.handleChangeComment}
                onChangeKeep={this.handleChangeKeep}
                onSave={this.handleSave}
            />
        );
    }
}

SaveVersionModal.propTypes = {
    onRequestClose: PropTypes.func.isRequired,
    onSaveSuccess: PropTypes.func.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onRequestClose: () => dispatch(closeSaveVersionModal()),
    onSaveSuccess: () => showAlertWithTimeout(dispatch, 'saveSuccess')
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(SaveVersionModal);
