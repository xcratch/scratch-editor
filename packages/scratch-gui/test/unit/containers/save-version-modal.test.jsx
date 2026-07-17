import React from 'react';
import {screen, fireEvent, waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import configureStore from 'redux-mock-store';

import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import SaveVersionModal from '../../../src/containers/save-version-modal.jsx';

describe('Save Version Modal Container', () => {
    const getStore = saveProjectVersion => configureStore()({
        locales: {
            isRtl: false,
            locale: 'en-US'
        },
        scratchGui: {
            vm: {
                runtime: {
                    saveProjectVersion
                }
            }
        }
    });

    test('dispatches close and success alert actions when saving succeeds', async () => {
        const saveProjectVersion = jest.fn().mockResolvedValue();
        const store = getStore(saveProjectVersion);

        renderWithIntl(
            <Provider store={store}>
                <SaveVersionModal />
            </Provider>
        );

        fireEvent.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => {
            const actions = store.getActions();
            expect(actions.some(action => action.type === 'scratch-gui/modals/CLOSE_MODAL' &&
                action.modal === 'saveVersion')).toBe(true);
            expect(actions.some(action => action.type === 'scratch-gui/alerts/SHOW_ALERT' &&
                action.alertId === 'saveSuccess')).toBe(true);
        });
    });

    test('shows an error and does not close the modal when saving fails', async () => {
        const saveProjectVersion = jest.fn().mockRejectedValue(new Error('boom'));
        const store = getStore(saveProjectVersion);

        renderWithIntl(
            <Provider store={store}>
                <SaveVersionModal />
            </Provider>
        );

        fireEvent.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => {
            expect(screen.getByText('Failed to save: boom')).toBeTruthy();
        });

        const actions = store.getActions();
        expect(actions.some(action => action.type === 'scratch-gui/modals/CLOSE_MODAL')).toBe(false);
        expect(actions.some(action => action.type === 'scratch-gui/alerts/SHOW_ALERT')).toBe(false);
    });
});
