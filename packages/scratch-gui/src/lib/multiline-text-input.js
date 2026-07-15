/**
 * Multiline Text Input Extension for Scratch Blocks
 * Patches plain FieldTextInput fields at runtime so their editor supports
 * multi-line content. The editor element is always a single <textarea>; only
 * its *form* is switched dynamically based on the content:
 * - short single-line content: styled to look exactly like the original
 *   single-line <input> editor (auto-growing width, workspace-scale
 *   transform)
 * - multi-line content or content at/above the threshold: a resizable,
 *   wrapping textarea overlay
 * In both forms Enter inserts a newline (switching to the multiline form as
 * needed) and focusing out commits the value.
 * Because the DOM element never changes mid-edit, switching forms while the
 * user is typing does not interrupt IME composition (e.g. Japanese input).
 * scratch-blocks itself ships as a prebuilt npm package whose source cannot
 * be modified, so this module monkey-patches its prototypes the same way
 * enhanced-cleanup.js does for WorkspaceSvg#cleanUp.
 */

import log from './log.js';

const STYLE_ELEMENT_ID = 'multilineTextInputStyles';

/**
 * Inject the CSS needed for the two editor forms.
 * Guarded by element id so repeated calls are no-ops.
 * @param {object} ScratchBlocks - The ScratchBlocks instance (for layout constants)
 * @returns {void}
 */
const injectStyles = ScratchBlocks => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
        return;
    }
    // The single-line form must center its one text line vertically the way a
    // native <input> does; the WidgetDiv is sized to FIELD_HEIGHT_MAX_EDIT + 1
    // by the original resizeEditor_, so use that as the line height.
    const singleLineHeight = ScratchBlocks.BlockSvg.FIELD_HEIGHT_MAX_EDIT + 1;
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    // The `textarea.` prefix keeps these rules more specific than the
    // .blocklyHtmlInput rules injected by scratch-blocks (which set
    // text-align: center etc.), regardless of stylesheet order.
    // Font family/size/weight/color are inherited from .blocklyHtmlInput,
    // which the textarea also carries.
    style.textContent = `
        textarea.blocklyHtmlTextareaOneline {
            display: block;
            resize: none;
            overflow: hidden;
            white-space: pre;
            padding: 0;
            line-height: ${singleLineHeight}px;
            box-sizing: border-box;
        }
        textarea.blocklyHtmlTextarea {
            display: block;
            resize: both;
            overflow: auto;
            text-align: left;
            white-space: pre-wrap;
            word-wrap: break-word;
            box-sizing: border-box;
            padding: 4px;
            border-radius: 4px;
            line-height: normal;
        }
    `;
    document.head.appendChild(style);
};

/**
 * Install multi-line editing support for plain text input fields.
 * @param {object} ScratchBlocks - The ScratchBlocks instance
 * @param {object} options - Configuration options
 * @param {number} options.truncateLength - Content at or above this length (or with a newline)
 *     is shown truncated on the block face and edited in the multiline form (default 32)
 * @param {boolean} options.includeRemovable - Whether FieldTextInputRemovable fields are also treated as multiline
 * @returns {object|null} Object with restore method, or null if ScratchBlocks is unavailable or already patched
 */
export const installMultilineTextInput = (ScratchBlocks, options = {}) => {
    if (!ScratchBlocks || !ScratchBlocks.FieldTextInput || !ScratchBlocks.Field) {
        log.warn('ScratchBlocks not available for multiline text input');
        return null;
    }

    // Idempotency guard: VMScratchBlocks may return the same require-cached
    // ScratchBlocks object multiple times (once per VM instance), so avoid
    // re-wrapping already-wrapped prototype methods.
    if (ScratchBlocks.__multilineTextInputInstalled) {
        return null;
    }
    ScratchBlocks.__multilineTextInputInstalled = true;

    const truncateLength = options.truncateLength || 32;
    const includeRemovable = Boolean(options.includeRemovable);

    /**
     * Determine whether a field should get multiline treatment.
     * Uses a strict constructor check (not instanceof) so that subclasses
     * like FieldNumber, FieldAngle, FieldNote, FieldTextDropdown, etc. -
     * all of which also inherit from FieldTextInput or Field - keep their
     * original single-line behaviour.
     * @param {object} field - The field instance to check
     * @returns {boolean} True if the field should use the multiline-capable editor
     */
    const isMultilineTarget = field => (
        field.constructor === ScratchBlocks.FieldTextInput ||
        (includeRemovable && field.constructor === ScratchBlocks.FieldTextInputRemovable)
    );

    /**
     * Whether the given content needs the multiline form: it has a newline
     * or is at/above the threshold.
     * @param {string} text - The field content to check
     * @returns {boolean} True if the content needs multiline treatment
     */
    const needsMultiline = text => (/\r|\n/).test(text) || text.length >= truncateLength;

    /**
     * Whether the currently open editor is our textarea in multiline form.
     * @returns {boolean} True if the multiline form is active
     */
    const isMultilineFormOpen = () => {
        const htmlInput = ScratchBlocks.FieldTextInput.htmlInput_;
        return Boolean(htmlInput && htmlInput.__multilineForm);
    };

    /**
     * Apply one of the two editor forms to the (already open) textarea.
     * Only styles and classes change - the element and its focus/IME
     * composition state are untouched, so this is safe to call mid-edit.
     * @param {object} field - The field being edited
     * @param {HTMLTextAreaElement} textarea - The editor element
     * @param {boolean} multiline - True for the multiline overlay form,
     *     false for the original single-line look
     * @returns {void}
     */
    const applyEditorForm = (field, textarea, multiline) => {
        const div = ScratchBlocks.WidgetDiv.DIV;
        textarea.__multilineForm = multiline;
        if (multiline) {
            textarea.classList.remove('blocklyHtmlTextareaOneline');
            textarea.classList.add('blocklyHtmlTextarea');

            // The single-line form (and other single-line editors sharing the
            // WidgetDiv) sizes and scales the div; the multiline form must
            // shrink-wrap the textarea, unscaled.
            div.style.width = 'auto';
            div.style.height = 'auto';
            div.style.transform = '';
            div.style.marginLeft = '';

            // Give the textarea a sensible initial, user-resizable size.
            let fieldWidth = 220;
            try {
                const bbox = field.getScaledBBox_();
                fieldWidth = Math.max(bbox.right - bbox.left, 220);
            } catch (e) {
                // Fall back to the default width if measurement isn't available.
                fieldWidth = Math.max((field.size_ && field.size_.width) || 0, 220);
            }
            textarea.style.width = `${fieldWidth}px`;
            textarea.style.height = '72px';
            textarea.style.minWidth = '220px';
            textarea.style.minHeight = '72px';

            // Match the border look of the original editor. The original does
            // this in resizeEditor_; it is done here instead because the
            // multiline resizeEditor_ only repositions the widget.
            const borderRadius = `${field.getBorderRadius() + 0.5}px`;
            div.style.borderRadius = borderRadius;
            textarea.style.borderRadius = borderRadius;
            div.style.borderColor = field.sourceBlock_.getColourTertiary();

            // The original editor scales the whole widget div with
            // `transform: scale(workspace.scale)`; the multiline form stays
            // unscaled (so native resize works), so the workspace scale is
            // baked into the font size instead to visually match the
            // original field text.
            textarea.style.fontSize =
                `${ScratchBlocks.BlockSvg.FIELD_TEXTINPUT_FONTSIZE_FINAL * field.workspace_.scale}pt`;
        } else {
            textarea.classList.remove('blocklyHtmlTextarea');
            textarea.classList.add('blocklyHtmlTextareaOneline');
            // Let the .blocklyHtmlInput 100%-of-div sizing take over; the div
            // itself is sized, scaled and bordered by the original
            // resizeEditor_ below.
            textarea.style.width = '';
            textarea.style.height = '';
            textarea.style.minWidth = '';
            textarea.style.minHeight = '';
            textarea.style.fontSize = `${ScratchBlocks.BlockSvg.FIELD_TEXTINPUT_FONTSIZE_FINAL}pt`;
        }
        field.resizeEditor_();
    };

    injectStyles(ScratchBlocks);

    // -----------------------------------------------------------------
    // Display truncation: Field.prototype.getDisplayText_
    // -----------------------------------------------------------------
    const originalGetDisplayText_ = ScratchBlocks.Field.prototype.getDisplayText_;

    // NOTE: Keep this in sync with Blockly.Field.prototype.getDisplayText_
    // in scratch-blocks/core/field.js whenever scratch-blocks is updated.
    ScratchBlocks.Field.prototype.getDisplayText_ = function () {
        if (!isMultilineTarget(this)) {
            return originalGetDisplayText_.call(this);
        }

        let text = this.text_;
        if (!text) {
            // Prevent the field from disappearing if empty.
            return ScratchBlocks.Field.NBSP;
        }

        if (needsMultiline(text)) {
            // Truncate to the first line and add an ellipsis, keeping the
            // total display at most truncateLength characters.
            const firstLine = text.split(/\r\n|\r|\n/, 1)[0];
            text = `${firstLine.substring(0, truncateLength - 1)}…`;
        }

        // Replace whitespace with non-breaking spaces so the text doesn't collapse.
        text = text.replace(/\s/g, ScratchBlocks.Field.NBSP);
        if (this.sourceBlock_.RTL) {
            // The SVG is LTR, force text to be RTL unless a number.
            if (this.sourceBlock_.editable_ && this.sourceBlock_.type === 'math_number') {
                text = `‪${text}‬`;
            } else {
                text = `‫${text}‬`;
            }
        }
        return text;
    };

    // -----------------------------------------------------------------
    // Editor creation: FieldTextInput.prototype.showEditor_
    // -----------------------------------------------------------------
    const originalShowEditor_ = ScratchBlocks.FieldTextInput.prototype.showEditor_;

    ScratchBlocks.FieldTextInput.prototype.showEditor_ = function (
        quietInputOpt, readOnlyOpt, withArrowOpt, arrowCallbackOpt) {
        if (!isMultilineTarget(this)) {
            originalShowEditor_.call(this, quietInputOpt, readOnlyOpt, withArrowOpt, arrowCallbackOpt);
            return;
        }

        this.workspace_ = this.sourceBlock_.workspace;
        const quietInput = quietInputOpt || false;
        const readOnly = readOnlyOpt || false;
        ScratchBlocks.WidgetDiv.show(this, this.sourceBlock_.RTL,
            this.widgetDispose_(), this.widgetDisposeAnimationFinished_(),
            ScratchBlocks.FieldTextInput.ANIMATION_TIME);
        const div = ScratchBlocks.WidgetDiv.DIV;
        // Apply text-input-specific fixed CSS
        div.className += ' fieldTextInput';

        // Always a textarea, regardless of form, so that switching forms
        // mid-edit never replaces the element (which would break IME
        // composition).
        const textarea = document.createElement('textarea');
        textarea.className = 'blocklyHtmlInput';
        textarea.setAttribute('spellcheck', this.spellcheck_);
        if (readOnly) {
            textarea.setAttribute('readonly', 'true');
        }

        /** @type {!HTMLTextAreaElement} */
        ScratchBlocks.FieldTextInput.htmlInput_ = textarea;
        div.appendChild(textarea);

        textarea.value = textarea.defaultValue = this.text_;
        textarea.oldValue_ = null;
        this.validate_();
        applyEditorForm(this, textarea, needsMultiline(this.text_ || ''));
        if (!quietInput) {
            textarea.focus();
            textarea.setSelectionRange(0, textarea.value.length);
        }

        this.bindEvents_(textarea, quietInput || readOnly);

        // Add animation transition properties
        div.style.transition = `box-shadow ${ScratchBlocks.FieldTextInput.ANIMATION_TIME}s`;
        textarea.style.transition = `font-size ${ScratchBlocks.FieldTextInput.ANIMATION_TIME}s`;
        div.style.boxShadow = `0px 0px 0px 4px ${ScratchBlocks.Colours.fieldShadow}`;
    };

    // -----------------------------------------------------------------
    // Position updates: FieldTextInput.prototype.resizeEditor_
    // -----------------------------------------------------------------
    const originalResizeEditor_ = ScratchBlocks.FieldTextInput.prototype.resizeEditor_;

    ScratchBlocks.FieldTextInput.prototype.resizeEditor_ = function () {
        if (!isMultilineTarget(this) || !isMultilineFormOpen()) {
            // The original resizeEditor_ only reads the editor element's
            // style/value, so it also handles our textarea in single-line
            // form (auto-growing div width, scale transform, border).
            originalResizeEditor_.call(this);
            return;
        }

        // Multiline form: only reposition the widget div; width/height are
        // left alone so that the user's manual textarea resize (CSS
        // `resize: both`) is preserved. Position math follows the original
        // resizeEditor_ in scratch-blocks/core/field_textinput.js, minus the
        // sizing parts.
        const div = ScratchBlocks.WidgetDiv.DIV;
        const scale = this.sourceBlock_.workspace.scale;
        // Keep the font size in sync with the workspace zoom (see applyEditorForm).
        const htmlInput = ScratchBlocks.FieldTextInput.htmlInput_;
        if (htmlInput) {
            htmlInput.style.fontSize =
                `${ScratchBlocks.BlockSvg.FIELD_TEXTINPUT_FONTSIZE_FINAL * scale}pt`;
        }
        const xy = this.getAbsoluteXY_();
        // Account for border width, post-scale
        xy.x -= scale / 2;
        xy.y -= scale / 2;
        // In RTL mode the right edge of the editor stays aligned with the
        // right edge of the field; the left edge moves.
        if (this.sourceBlock_.RTL) {
            xy.x += this.size_.width * scale;
            xy.x -= div.offsetWidth;
        }
        // Shift by a pixel to line up exactly.
        xy.y += 1 * scale;
        div.style.left = `${xy.x}px`;
        div.style.top = `${xy.y}px`;
    };

    // -----------------------------------------------------------------
    // Key handling: FieldTextInput.prototype.onHtmlInputKeyDown_
    // -----------------------------------------------------------------
    const originalOnHtmlInputKeyDown_ = ScratchBlocks.FieldTextInput.prototype.onHtmlInputKeyDown_;

    ScratchBlocks.FieldTextInput.prototype.onHtmlInputKeyDown_ = function (e) {
        const enterKey = 13;
        const tabKey = 9;
        const escKey = 27;
        if (!isMultilineTarget(this)) {
            originalOnHtmlInputKeyDown_.call(this, e);
            return;
        }
        // Never commit/close while an IME composition is in progress
        // (e.g. Enter that confirms a Japanese conversion).
        if (e.isComposing || e.keyCode === 229) {
            return;
        }
        const htmlInput = ScratchBlocks.FieldTextInput.htmlInput_;
        if (!isMultilineFormOpen()) {
            // Single-line form. Enter is not passed to the original handler
            // (which would commit and close); the textarea's default action
            // inserts a newline instead, and the input handler below then
            // switches to the multiline form. Committing is done by focusing
            // out; Esc/Tab keep the original behaviour.
            if (e.keyCode !== enterKey) {
                originalOnHtmlInputKeyDown_.call(this, e);
            }
            return;
        }

        // Multiline form: Enter is intentionally not handled so the
        // textarea's default behaviour (insert a newline) applies.
        if (e.keyCode === escKey) {
            htmlInput.value = htmlInput.defaultValue;
            ScratchBlocks.WidgetDiv.hide();
            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
        } else if (e.keyCode === tabKey) {
            ScratchBlocks.WidgetDiv.hide();
            ScratchBlocks.DropDownDiv.hideWithoutAnimation();
            this.sourceBlock_.tab(this, !e.shiftKey);
            e.preventDefault();
        }
    };

    // -----------------------------------------------------------------
    // Blur-to-commit and dynamic form switching:
    // wrap bindEvents_ / unbindEvents_
    // -----------------------------------------------------------------
    const originalBindEvents_ = ScratchBlocks.FieldTextInput.prototype.bindEvents_;
    const originalUnbindEvents_ = ScratchBlocks.FieldTextInput.prototype.unbindEvents_;

    ScratchBlocks.FieldTextInput.prototype.bindEvents_ = function (htmlInput, bindGlobalKeypress) {
        originalBindEvents_.call(this, htmlInput, bindGlobalKeypress);
        if (!isMultilineTarget(this)) {
            return;
        }
        const field = this;
        htmlInput.onBlurWrapper_ = ScratchBlocks.bindEvent_(htmlInput, 'blur', this, () => {
            if (ScratchBlocks.WidgetDiv.owner_ === field) {
                ScratchBlocks.WidgetDiv.hide();
            }
        });
        // Switch the editor form whenever the content crosses the multiline
        // threshold. Only classes/styles change, so this is IME-safe even
        // when it fires mid-composition.
        htmlInput.onFormSwitchWrapper_ = ScratchBlocks.bindEvent_(htmlInput, 'input', this, () => {
            const multiline = needsMultiline(htmlInput.value);
            if (multiline !== Boolean(htmlInput.__multilineForm)) {
                applyEditorForm(field, htmlInput, multiline);
            }
        });
    };

    ScratchBlocks.FieldTextInput.prototype.unbindEvents_ = function (htmlInput) {
        originalUnbindEvents_.call(this, htmlInput);
        if (htmlInput.onBlurWrapper_) {
            ScratchBlocks.unbindEvent_(htmlInput.onBlurWrapper_);
            htmlInput.onBlurWrapper_ = null;
        }
        if (htmlInput.onFormSwitchWrapper_) {
            ScratchBlocks.unbindEvent_(htmlInput.onFormSwitchWrapper_);
            htmlInput.onFormSwitchWrapper_ = null;
        }
    };

    return {
        restore: () => {
            ScratchBlocks.Field.prototype.getDisplayText_ = originalGetDisplayText_;
            ScratchBlocks.FieldTextInput.prototype.showEditor_ = originalShowEditor_;
            ScratchBlocks.FieldTextInput.prototype.resizeEditor_ = originalResizeEditor_;
            ScratchBlocks.FieldTextInput.prototype.onHtmlInputKeyDown_ = originalOnHtmlInputKeyDown_;
            ScratchBlocks.FieldTextInput.prototype.bindEvents_ = originalBindEvents_;
            ScratchBlocks.FieldTextInput.prototype.unbindEvents_ = originalUnbindEvents_;
            ScratchBlocks.__multilineTextInputInstalled = false;
        }
    };
};

export default installMultilineTextInput;
