import React from 'react';
import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import MenuBar from '../../../src/components/menu-bar/menu-bar';
import {menuInitialState} from '../../../src/reducers/menus';
import {LoadingState} from '../../../src/reducers/project-state';
import {DEFAULT_MODE} from '../../../src/lib/settings/color-mode';
import {fireEvent, screen} from '@testing-library/react';

import {PLATFORM} from '../../../src/lib/platform';

import configureStore from 'redux-mock-store';
import {Provider} from 'react-redux';
import VM from '@scratch/scratch-vm';

describe('MenuBar Component', () => {
    const store = configureStore()({
        locales: {
            isRtl: false,
            locale: 'en-US'
        },
        scratchGui: {
            menus: menuInitialState,
            projectState: {
                loadingState: LoadingState.NOT_LOADED
            },
            settings: {
                colorMode: DEFAULT_MODE
            },
            timeTravel: {
                year: 'NOW'
            },
            vm: new VM(),
            platform: {
                platform: PLATFORM.WEB
            }
        }
    });

    const getComponent = function (props = {}) {
        return <Provider store={store}><MenuBar {...props} /></Provider>;
    };

    test('menu bar with no About handler has no About button', () => {
        const {container} = renderWithIntl(getComponent());
        const button = container.querySelector('span[role="button"]');
        expect(button).toBeFalsy();
    });

    test('menu bar with an About handler has an About button', () => {
        const onClickAbout = jest.fn();
        const {container} = renderWithIntl(getComponent({onClickAbout}));
        const button = container.querySelector('span[role="button"]');
        expect(button).toBeTruthy();
    });

    describe('triggering About button handler', () => {
        test('clicking on About button calls the handler', () => {
            const onClickAbout = jest.fn();
            const {container} = renderWithIntl(getComponent({onClickAbout}));
            const button = container.querySelector('span[role="button"]');
    
            fireEvent.click(button);
            expect(onClickAbout).toHaveBeenCalledTimes(1);
        });
    
        test('not clicking on About button does not call the handler', () => {
            const onClickAbout = jest.fn();
            const {container} = renderWithIntl(getComponent({onClickAbout}));
            const button = container.querySelector('span[role="button"]');

            expect(onClickAbout).toHaveBeenCalledTimes(0);
        });
    });

    describe('save with a comment menu item', () => {
        const getStoreWithFileMenu = ({canSaveProjectVersion}) => configureStore()({
            locales: {
                isRtl: false,
                locale: 'en-US'
            },
            scratchGui: {
                config: {
                    storage: canSaveProjectVersion ? {saveVersionWithMeta: () => Promise.resolve()} : {}
                },
                menus: {
                    ...menuInitialState,
                    fileMenu: true
                },
                projectState: {
                    loadingState: canSaveProjectVersion ?
                        LoadingState.SHOWING_WITH_ID :
                        LoadingState.NOT_LOADED
                },
                settings: {
                    colorMode: DEFAULT_MODE
                },
                timeTravel: {
                    year: 'NOW'
                },
                vm: new VM(),
                platform: {
                    platform: PLATFORM.WEB
                }
            }
        });

        test('shows "Save with a comment" and dispatches on click when allowed', () => {
            const fileMenuStore = getStoreWithFileMenu({canSaveProjectVersion: true});
            renderWithIntl(
                <Provider store={fileMenuStore}>
                    <MenuBar canManageFiles />
                </Provider>
            );

            const menuItem = screen.getByText('Save with a comment');
            expect(menuItem).toBeTruthy();

            fireEvent.click(menuItem);

            const actions = fileMenuStore.getActions();
            expect(actions.some(action => action.modal === 'saveVersion')).toBe(true);
        });

        test('hides "Save with a comment" when not allowed', () => {
            const fileMenuStore = getStoreWithFileMenu({canSaveProjectVersion: false});
            renderWithIntl(
                <Provider store={fileMenuStore}>
                    <MenuBar canManageFiles />
                </Provider>
            );

            expect(screen.queryByText('Save with a comment')).toBeFalsy();
        });
    });
});
