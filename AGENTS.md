# AGENTS.md - xcratch/scratch-editor

Guide for AI agents working on this repository.

## Overview

This is the Xcratch fork of [scratchfoundation/scratch-editor](https://github.com/scratchfoundation/scratch-editor)
(monorepo of scratch-gui, scratch-vm, scratch-render, ...).

- `xcratch`: main development branch
- `xcratch.github.io`: branch built and published to <https://xcratch.github.io> and <https://microbit-more.github.io>

## Merging upstream

When merging changes from scratchfoundation/scratch-editor, keep the Xcratch-specific changes below.

### Keep `#scratch-link-extension-script` in the static HTML

`packages/scratch-gui/src/playground/index.ejs` must have this element right after `<body>`:

```html
<script id="scratch-link-extension-script"></script>
```

Do not remove it or move it into JavaScript, even if upstream's template does not have it.

Why:

- Scratch Link Safari helpers check for this element once the page has loaded, and only then inject
  `self.Scratch.ScratchLinkSafariSocket`. Helpers include Scratch Link for Safari, and Scrub on iPad,
  which emulates Scratch Link instead of providing Web Bluetooth.
  Scrub checks only once, at `WKUserScript` `atDocumentEnd`.
- `Runtime._initScratchLink()` in scratch-vm also creates the element, but too late for those helpers:
  - since upstream `89d37d8b41`, the playground creates the VM in `EditorState`, while React renders
    asynchronously;
  - Xcratch's `render-gui.jsx` renders only after an async IndexedDB check.
- Without the element, connecting to peripherals (micro:bit, etc.) fails on Scrub. This happened in
  the 2026-10 release.
- scratch.mit.edu does not need it because scratch-www creates the VM when the module is evaluated
  (`guiInitialState`).

After merging, check that the built `build/index.html` still has the element.
