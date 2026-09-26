import classNames from 'classnames';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import React, {useCallback} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {setProjectTitle} from '../../reducers/project-title';

import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import Input from '../forms/input.jsx';
const BufferedInput = BufferedInputHOC(Input);

import styles from './project-title-input.css';

const messages = defineMessages({
    projectTitlePlaceholder: {
        id: 'gui.gui.projectTitlePlaceholder',
        description: 'Placeholder for project title when blank',
        defaultMessage: 'Project title here'
    }
});

const ProjectTitleInput = ({
    className,
    onSubmit,
    onTitleChanged,
    projectTitle
}) => {
    const intl = useIntl();
    // BufferedInput submits on blur whenever the field was typed in, even if the
    // value ends up unchanged; only report real renames.
    const handleSubmit = useCallback(title => {
        if (title === projectTitle) return;
        onSubmit(title);
        if (onTitleChanged) onTitleChanged(title);
    }, [onSubmit, onTitleChanged, projectTitle]);
    return (
        <BufferedInput
            className={classNames(styles.titleField, className)}
            maxLength="100"
            placeholder={intl.formatMessage(messages.projectTitlePlaceholder)}
            tabIndex="0"
            type="text"
            value={projectTitle}
            onSubmit={handleSubmit}
        />
    );
};

ProjectTitleInput.propTypes = {
    className: PropTypes.string,
    onSubmit: PropTypes.func,
    onTitleChanged: PropTypes.func,
    projectTitle: PropTypes.string
};

const mapStateToProps = state => ({
    projectTitle: state.scratchGui.projectTitle
});

const mapDispatchToProps = dispatch => ({
    onSubmit: title => dispatch(setProjectTitle(title))
});

export default connect(mapStateToProps, mapDispatchToProps)(ProjectTitleInput);
