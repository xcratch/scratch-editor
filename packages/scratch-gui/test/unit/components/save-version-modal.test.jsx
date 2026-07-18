import React from 'react';
import {screen, fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import {Provider} from 'react-redux';
import configureStore from 'redux-mock-store';

import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import SaveVersionModal from '../../../src/components/save-version-modal/save-version-modal.jsx';

describe('SaveVersionModal Component', () => {
    const store = configureStore()({
        locales: {
            isRtl: false,
            locale: 'en-US'
        }
    });

    let onCancel;
    let onChangeComment;
    let onChangeKeep;
    let onSave;

    beforeEach(() => {
        onCancel = jest.fn();
        onChangeComment = jest.fn();
        onChangeKeep = jest.fn();
        onSave = jest.fn();
    });

    const getComponent = function (props = {}) {
        return (
            <Provider store={store}>
                <SaveVersionModal
                    comment=""
                    error={null}
                    isKeep={false}
                    saving={false}
                    onCancel={onCancel}
                    onChangeComment={onChangeComment}
                    onChangeKeep={onChangeKeep}
                    onSave={onSave}
                    {...props}
                />
            </Provider>
        );
    };

    test('calls onChangeComment when the comment textarea changes', () => {
        renderWithIntl(getComponent());
        const textarea = screen.getByPlaceholderText('Write a comment…');
        fireEvent.change(textarea, {target: {value: 'a new comment'}});
        expect(onChangeComment).toHaveBeenCalled();
    });

    test('calls onChangeKeep when the keep checkbox changes', () => {
        renderWithIntl(getComponent());
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(onChangeKeep).toHaveBeenCalled();
    });

    test('calls onCancel when the cancel button is clicked', () => {
        renderWithIntl(getComponent());
        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        expect(onCancel).toHaveBeenCalled();
    });

    test('calls onSave when the save button is clicked', () => {
        renderWithIntl(getComponent());
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        expect(onSave).toHaveBeenCalled();
    });

    test('disables inputs and shows "Saving…" while saving', () => {
        renderWithIntl(getComponent({saving: true}));
        expect(screen.getByPlaceholderText('Write a comment…')).toBeDisabled();
        expect(screen.getByRole('checkbox')).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Cancel'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Saving…'})).toBeDisabled();
    });

    test('shows the error message when error is set', () => {
        renderWithIntl(getComponent({error: 'network error'}));
        expect(screen.getByText('Failed to save: network error')).toBeTruthy();
    });

    test('does not show an error message when error is null', () => {
        renderWithIntl(getComponent());
        expect(screen.queryByText(/Failed to save/)).toBeFalsy();
    });
});
