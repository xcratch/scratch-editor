/**
 * Report Bubble Copy - Make the value-report bubble (shown when a reporter
 * block is clicked) selectable and add a button to copy its value.
 */

let initialized = false;
let intl = null;

const COPIED_FEEDBACK_DURATION = 1500;

const copyTextToClipboard = text => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback for insecure contexts / older browsers.
    return new Promise((resolve, reject) => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            if (document.execCommand('copy')) {
                resolve();
            } else {
                reject(new Error('execCommand copy failed'));
            }
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        } finally {
            document.body.removeChild(textArea);
        }
    });
};

const createCopyButton = value => {
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    const copyLabel = intl.formatMessage({
        id: 'xcratch.reportBubble.copy',
        defaultMessage: 'Copy',
        description: 'Button in the value-report bubble to copy the value to the clipboard'
    });
    button.textContent = copyLabel;
    Object.assign(button.style, {
        display: 'block',
        margin: '0.25rem auto 0',
        padding: '0.125rem 0.75rem',
        border: '1px solid rgba(0, 0, 0, 0.15)',
        borderRadius: '1rem',
        background: 'rgba(0, 0, 0, 0.05)',
        color: '#575e75',
        fontSize: '0.75rem',
        fontFamily: 'inherit',
        cursor: 'pointer'
    });
    // Keep the bubble and any text selection intact when pressing the button.
    button.addEventListener('mousedown', e => e.stopPropagation());
    let feedbackTimeout = null;
    button.addEventListener('click', e => {
        e.stopPropagation();
        copyTextToClipboard(value).then(() => {
            button.textContent = intl.formatMessage({
                id: 'xcratch.reportBubble.copied',
                defaultMessage: 'Copied!',
                description: 'Feedback shown after the value-report bubble value was copied'
            });
            clearTimeout(feedbackTimeout);
            feedbackTimeout = setTimeout(() => {
                button.textContent = copyLabel;
            }, COPIED_FEEDBACK_DURATION);
        });
    });
    return button;
};

/**
 * Initialize the report-bubble copy functionality.
 * Safe to call multiple times; the reportValue patch is applied once but
 * the formatMessage reference is refreshed on every call.
 * @param {object} scratchBlocks - The ScratchBlocks object
 * @param {function(object): string} formatMessage - The intl formatMessage function
 */
export const initializeReportBubbleCopy = (scratchBlocks, formatMessage) => {
    intl = {formatMessage};

    if (initialized) return;

    const originalReportValue = scratchBlocks.WorkspaceSvg.prototype.reportValue;
    scratchBlocks.WorkspaceSvg.prototype.reportValue = function (id, value) {
        originalReportValue.call(this, id, value);
        const contentDiv = scratchBlocks.DropDownDiv.getContentDiv();
        const valueReportBox = contentDiv.querySelector('.valueReportBox');
        if (!valueReportBox) return;
        // Override the `user-select: none` inherited from .blocklyDropDownDiv.
        valueReportBox.style.userSelect = 'text';
        valueReportBox.style.webkitUserSelect = 'text';
        valueReportBox.style.cursor = 'text';
        valueReportBox.addEventListener('mousedown', e => e.stopPropagation());
        contentDiv.appendChild(createCopyButton(value));
    };

    initialized = true;
};
