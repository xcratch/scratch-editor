// Polyfills
import 'es6-object-assign/auto';
import 'core-js/fn/array/includes';
import 'core-js/fn/promise/finally';
import 'intl'; // For Safari 9

import React from 'react';
import ReactDomClient from 'react-dom/client';

import AppStateHOC from '../lib/app-state-hoc.jsx';
import BrowserModalComponent from '../components/browser-modal/browser-modal.jsx';
import supportedBrowser from '../lib/supported-browser';

// index.css imposes the full-editor minimum size (1024x640) on html/body, so in
// player (embed) mode load the viewport-filling player stylesheet instead.
const isPlayer = new URLSearchParams(window.location.search).get('is_player') === 'true';
const cssModule = isPlayer ? require('./workshop-player.css') : require('./index.css');
const styles = cssModule.default || cssModule;

const appTarget = document.createElement('div');
appTarget.className = styles.app;
document.body.appendChild(appTarget);

if (supportedBrowser()) {
    // require needed here to avoid importing unsupported browser-crashing code
    // at the top level
    require('./render-workshop-gui.jsx').default(appTarget);

} else {
    BrowserModalComponent.setAppElement(appTarget);
    const WrappedBrowserModalComponent = AppStateHOC(BrowserModalComponent, true /* localesOnly */);
    const handleBack = () => {};
    const root = ReactDomClient.createRoot(appTarget);
    // eslint-disable-next-line react/jsx-no-bind
    root.render(<WrappedBrowserModalComponent onBack={handleBack} />);
}
