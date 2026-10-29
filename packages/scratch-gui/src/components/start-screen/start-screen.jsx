import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, FormattedMessage} from 'react-intl';
import intlShape from '../../lib/intlShape.js';

import LanguageSelector from '../../containers/language-selector.jsx';
import languageIcon from '../language-selector/language-icon.svg';
import dropdownCaret from '../menu-bar/dropdown-caret.svg';
import scratchLogo from '../menu-bar/scratch-logo.svg';

import styles from './start-screen.css';

const messages = defineMessages({
    title: {
        id: 'xcratch.startScreen.title',
        defaultMessage: 'Start',
        description: 'Accessible label of the start screen listing projects saved in the browser'
    },
    language: {
        id: 'xcratch.startScreen.language',
        defaultMessage: 'Language',
        description: 'Accessible label of the language selector on the start screen'
    }
});

const PlusIcon = () => (
    <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
    >
        <path d="M12 5v14M5 12h14" />
    </svg>
);

const ClockIcon = () => (
    <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
    >
        <circle
            cx="12"
            cy="12"
            r="8.5"
        />
        <path d="M12 7.5V12l3 2" />
    </svg>
);

const UploadIcon = () => (
    <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
    >
        <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v4h14v-4" />
    </svg>
);

/**
 * Full-page start screen shown over the editor: action tiles (new, continue,
 * load from computer) above the list of projects saved in the browser, which
 * is passed as children.
 * @param {object} props - component props
 * @returns {React.ReactElement} the start screen
 */
const StartScreen = ({
    children,
    continueProject,
    intl,
    onContinue,
    onLoadFromComputer,
    onNewProject
}) => (
    <div
        aria-label={intl.formatMessage(messages.title)}
        className={styles.startScreen}
        role="dialog"
    >
        <header className={styles.header}>
            <img
                alt="Xcratch"
                className={styles.logo}
                draggable={false}
                src={scratchLogo}
            />
            {/* The select is transparent over the icon, as in the menu bar */}
            <div className={styles.language}>
                <img
                    className={styles.languageIcon}
                    src={languageIcon}
                />
                <img
                    className={styles.languageCaret}
                    src={dropdownCaret}
                />
                <LanguageSelector label={intl.formatMessage(messages.language)} />
            </div>
        </header>
        <div className={styles.body}>
            <div className={styles.tiles}>
                <button
                    className={styles.tile}
                    onClick={onNewProject}
                >
                    <span className={classNames(styles.tileIcon, styles.tileIconPrimary)}>
                        <PlusIcon />
                    </span>
                    <span className={styles.tileLabel}>
                        <FormattedMessage
                            defaultMessage="New project"
                            description="Start screen tile that starts a new empty project"
                            id="xcratch.startScreen.new"
                        />
                    </span>
                </button>
                <button
                    className={styles.tile}
                    disabled={!continueProject}
                    onClick={onContinue}
                >
                    <span className={styles.tileIcon}>
                        {continueProject && continueProject.thumbnailUrl ? (
                            <img
                                className={styles.tileThumbnail}
                                draggable={false}
                                src={continueProject.thumbnailUrl}
                            />
                        ) : <ClockIcon />}
                    </span>
                    <span className={styles.tileLabel}>
                        <FormattedMessage
                            defaultMessage="Continue"
                            description="Start screen tile that opens the most recently edited project"
                            id="xcratch.startScreen.continue"
                        />
                        {continueProject && (
                            <span className={styles.tileDetail}>{continueProject.name}</span>
                        )}
                    </span>
                </button>
                <button
                    className={styles.tile}
                    onClick={onLoadFromComputer}
                >
                    <span className={styles.tileIcon}>
                        <UploadIcon />
                    </span>
                    <span className={styles.tileLabel}>
                        <FormattedMessage
                            defaultMessage="Load from your computer"
                            description="Start screen tile that opens a project file from the computer"
                            id="xcratch.startScreen.load"
                        />
                    </span>
                </button>
            </div>
            <div className={styles.projects}>
                {children}
            </div>
        </div>
    </div>
);

StartScreen.propTypes = {
    children: PropTypes.node,
    continueProject: PropTypes.shape({
        name: PropTypes.string,
        thumbnailUrl: PropTypes.string
    }),
    intl: intlShape.isRequired,
    onContinue: PropTypes.func.isRequired,
    onLoadFromComputer: PropTypes.func.isRequired,
    onNewProject: PropTypes.func.isRequired
};

export default injectIntl(StartScreen);
