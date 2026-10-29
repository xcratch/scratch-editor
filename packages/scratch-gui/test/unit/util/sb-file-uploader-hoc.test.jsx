import 'web-audio-test-api';

import React from 'react';
import configureStore from 'redux-mock-store';
import {render} from '@testing-library/react';
import {renderWithIntl} from '../../helpers/intl-helpers.jsx';
import {LoadingState} from '../../../src/reducers/project-state';
import VM from '@scratch/scratch-vm';

import SBFileUploaderHOC from '../../../src/lib/sb-file-uploader-hoc.jsx';
import {IntlProvider} from 'react-intl';

describe('SBFileUploaderHOC', () => {
    const mockStore = configureStore();
    let store;
    let vm;

    // Wrap this in a function so it gets test specific states and can be reused.
    const getContainer = function () {
        const Component = () => <div />;
        return SBFileUploaderHOC(Component);
    };

    const unwrappedInstance = () => {
        const WrappedComponent = getContainer();
        // default starting state: looking at a project you created, not logged in
        const wrapper = renderWithIntl(
            <WrappedComponent
                projectChanged
                canSave={false}
                cancelFileUpload={jest.fn()}
                closeFileMenu={jest.fn()}
                requestProjectUpload={jest.fn()}
                userOwnsProject={false}
                vm={vm}
                onLoadingFinished={jest.fn()}
                onLoadingStarted={jest.fn()}
                onUpdateProjectTitle={jest.fn()}
                store={store}
            />
        );
        return wrapper;
    };

    beforeEach(() => {
        vm = new VM();
        store = mockStore({
            scratchGui: {
                projectState: {
                    loadingState: LoadingState.SHOWING_WITHOUT_ID
                },
                vm: {}
            },
            locales: {
                locale: 'en'
            }
        });
    });

    test('if isLoadingUpload becomes true, without fileToUpload set, will call cancelFileUpload', () => {
        const mockedCancelFileUpload = jest.fn();
        const WrappedComponent = getContainer();
        const {rerender} = renderWithIntl(
            <WrappedComponent
                projectChanged
                canSave={false}
                cancelFileUpload={mockedCancelFileUpload}
                closeFileMenu={jest.fn()}
                isLoadingUpload={false}
                requestProjectUpload={jest.fn()}
                store={store}
                userOwnsProject={false}
                vm={vm}
                onLoadingFinished={jest.fn()}
                onLoadingStarted={jest.fn()}
                onUpdateProjectTitle={jest.fn()}
            />
        );
        rerender(
            <IntlProvider
                locale="en"
                messages={{ }}
            >
                <WrappedComponent
                    projectChanged
                    canSave={false}
                    cancelFileUpload={mockedCancelFileUpload}
                    closeFileMenu={jest.fn()}
                    isLoadingUpload
                    requestProjectUpload={jest.fn()}
                    store={store}
                    userOwnsProject={false}
                    vm={vm}
                    onLoadingFinished={jest.fn()}
                    onLoadingStarted={jest.fn()}
                    onUpdateProjectTitle={jest.fn()}
                />
            </IntlProvider>
        );
        expect(mockedCancelFileUpload).toHaveBeenCalled();
    });

    describe('loading as a new project (start screen)', () => {
        let startSelecting;

        // Renders with the real dispatch props (onLoadingFinished etc.), so
        // the store records what the upload dispatches.
        const renderUploader = (props = {}) => {
            const Component = ({onStartSelectingFileUpload}) => {
                startSelecting = onStartSelectingFileUpload;
                return <div />;
            };
            const WrappedComponent = SBFileUploaderHOC(Component);
            const element = extraProps => (
                <IntlProvider
                    locale="en"
                    messages={{}}
                >
                    <WrappedComponent
                        canSave
                        isLoadingUpload={false}
                        projectChanged={false}
                        store={store}
                        vm={vm}
                        {...props}
                        {...extraProps}
                    />
                </IntlProvider>
            );
            // Plain render: element() has its own IntlProvider, so rerendering
            // keeps the same tree (and the uploader instance holding the file).
            const {rerender} = render(element());
            return {finishUpload: () => rerender(element({
                isLoadingUpload: true,
                loadingState: LoadingState.LOADING_VM_FILE_UPLOAD
            }))};
        };

        const chooseFile = () => {
            const inputs = document.body.querySelectorAll('input[type="file"]');
            const input = inputs[inputs.length - 1];
            Object.defineProperty(input, 'files', {value: [new File(['sb3'], 'Uploaded.sb3')]});
            input.dispatchEvent(new Event('change'));
        };

        const finishedActionType = async () => {
            await new Promise(resolve => {
                const check = () => {
                    const done = store.getActions().find(a => /DONE_LOADING_VM|RETURN_TO_SHOWING/.test(a.type));
                    if (done) resolve(); else setTimeout(check, 10);
                };
                check();
            });
            return store.getActions().find(a => /DONE_LOADING_VM|RETURN_TO_SHOWING/.test(a.type)).type;
        };

        beforeEach(() => {
            vm.loadProject = jest.fn(() => Promise.resolve());
            window.confirm = jest.fn(() => true);
        });

        test('finishes without an id instead of saving over the current project', async () => {
            const {finishUpload} = renderUploader({loadingState: LoadingState.SHOWING_WITH_ID});
            startSelecting({asNewProject: true});
            chooseFile();
            expect(window.confirm).not.toHaveBeenCalled();
            expect(store.getActions().map(a => a.type)).toEqual(expect.arrayContaining([
                'scratch-gui/project-state/START_LOADING_VM_FILE_UPLOAD',
                'scratch-gui/modals/CLOSE_MODAL'
            ]));
            finishUpload();
            expect(await finishedActionType()).toBe('scratch-gui/project-state/DONE_LOADING_VM_WITHOUT_ID');
        });

        test('menu upload (click event) still saves into the current project', async () => {
            const {finishUpload} = renderUploader({loadingState: LoadingState.SHOWING_WITH_ID});
            startSelecting({type: 'click'});
            chooseFile();
            finishUpload();
            expect(await finishedActionType()).toBe('scratch-gui/project-state/DONE_LOADING_VM_TO_SAVE');
        });

        test('asks before discarding unsaved changes', () => {
            window.confirm = jest.fn(() => false);
            renderUploader({loadingState: LoadingState.SHOWING_WITH_ID, projectChanged: true});
            startSelecting({asNewProject: true});
            chooseFile();
            expect(window.confirm).toHaveBeenCalled();
            expect(store.getActions().map(a => a.type)).not.toContain(
                'scratch-gui/project-state/START_LOADING_VM_FILE_UPLOAD');
        });
    });
});
