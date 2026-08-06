import React from 'react';
import ReactDomClient from 'react-dom/client';

import AppStateHOC from '../lib/app-state-hoc.jsx';
import GUI from '../containers/gui.jsx';
import log from '../lib/log.js';
import {workshopConfigFactory} from '../workshop-config';

/*
 * Xcratch Workshop launch adapter (spec §7).
 *
 * Mounts the standard <GUI canSave> and wires the Scratch-compatible storage to a
 * workshop-scoped backend. Editor-side changes are intentionally minimal: we only
 * inject the storage host/token (via props that ProjectFetcherHOC forwards to
 * storage.setProjectHost/setAssetHost/setProjectToken) and enable canSave.
 *
 * URL query params:
 *   slug        (required) workshop slug
 *   project_id  (optional) load an existing project; omit for a new project
 *   token       (optional) projectToken for token-based reads
 *   mode        (optional) 'edit' (default) or 'remix'. In remix mode the project is
 *               opened read-only with the Remix button enabled (Scratch's "see inside
 *               someone else's project" experience); saving is only possible through
 *               remixing, which POSTs a new project with ?original_id=.
 *   api         (optional) API origin; default '' = relative (same-origin via dev proxy)
 *   session_id  (optional) workshop session id; scopes project creation to the
 *               session via the backend's /sessions/:sessionId/projects routes.
 *               Omit to fall back to the workshop's default session.
 *   title       (optional) the project's current title from the workshop DB, shown
 *               in the editor's title input. Omitted for new projects, where the
 *               editor falls back to 'Untitled' (the backend's default) instead of
 *               scratch-gui's localized "Scratch Project", so the first save doesn't
 *               rename the project.
 *   version     (optional) epoch-ms timestamp of a saved version (Phase 3 project
 *               history). When present, the editor loads that version's body
 *               instead of the current one and is forced read-only (canSave=false),
 *               regardless of mode/is_player, since saving here must never
 *               overwrite the live project with old content.
 *   nickname,code (optional, dev convenience) self-join before rendering to obtain
 *                 the participant cookie, so save works from a single URL.
 */

// scratch-gui's hardcoded default (empty) project id. Passing this as projectId makes
// ProjectFetcherHOC kick off the default-project load → SHOWING_WITHOUT_ID, which (with
// canCreateNew) auto-creates the project on the server.
const DEFAULT_PROJECT_ID = '0';

const getParams = () => {
    const q = new URLSearchParams(window.location.search);
    return {
        slug: q.get('slug') || '',
        // Default project id when no ?project_id= → load empty default → auto-create on save.
        projectId: q.get('project_id') || DEFAULT_PROJECT_ID,
        token: q.get('token'),
        // Trim trailing slash so `${api}/store/...` never doubles up.
        api: (q.get('api') || '').replace(/\/$/, ''),
        nickname: q.get('nickname'),
        code: q.get('code'),
        isPlayer: q.get('is_player') === 'true',
        sessionId: q.get('session_id'),
        title: q.get('title'),
        // Unknown values fall back to 'edit' so existing URLs keep working.
        mode: q.get('mode') === 'remix' ? 'remix' : 'edit',
        // Version history (Phase 3): epoch-ms timestamp of a saved version, or
        // null for the project's current (live) body.
        version: q.get('version') ? Number(q.get('version')) : null
    };
};

// Reflect the freshly-created project id into the URL so a reload exercises the
// load (GET) / update (PUT) paths. Skip the default id (it's not a real saved project).
const updateProjectIdInUrl = id => {
    if (id === null || String(id) === DEFAULT_PROJECT_ID) return;
    const url = new URL(window.location.href);
    url.searchParams.set('project_id', String(id));
    window.history.replaceState(null, '', url.toString());
    // replaceState only changes this iframe's URL; the embedding workshop page cannot
    // see it, so it would keep pointing at the pre-remix project. Notify the parent so
    // it can switch to the newly created project (same-origin proxy setup, so '*' is fine).
    if (window.parent !== window) {
        window.parent.postMessage({
            type: 'xcratch-workshop:project-id-updated',
            projectId: String(id)
        }, '*');
    }
};

const onClickLogo = () => {
    const api = (new URLSearchParams(window.location.search).get('api') || '').replace(/\/$/, '');
    window.location = `${api}/`;
};

// Dev convenience: self-join to obtain the participant cookie. Idempotent enough
// for repeated runs (re-issues the cookie). No-op unless nickname+code are given.
const maybeJoin = async ({api, slug, nickname, code}) => {
    if (!nickname || !code) return;
    try {
        await fetch(`${api}/api/workshops/${slug}/join`, {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({displayName: nickname, code})
        });
    } catch (e) {
        log.error('workshop join failed', e);
    }
};

export default async appTarget => {
    GUI.setAppElement(appTarget);

    const {slug, projectId, token, api, nickname, code, isPlayer, sessionId, title, mode, version} = getParams();
    if (!slug) {
        log.error('Xcratch Workshop: missing required ?slug= query param');
    }

    // Scratch-style split: your own project saves in place (no remix button); someone
    // else's project is read-only with only the Remix button (mode=remix, set by the
    // workshop page based on the project's `editable` flag). canCreateNew must be off
    // in remix mode too, or the saver would auto-create an empty project.
    const isRemixMode = mode === 'remix';
    const isVersionView = version !== null;
    // Viewing a past version is always read-only: never let a save from this view
    // silently overwrite the live project with old content.
    const canSave = !isPlayer && !isRemixMode && !isVersionView;
    const canRemix = !isPlayer && isRemixMode && !isVersionView;

    await maybeJoin({api, slug, nickname, code});

    const WrappedGui = AppStateHOC(GUI, false, workshopConfigFactory);

    const root = ReactDomClient.createRoot(appTarget);

    root.render(
        <WrappedGui
            isPlayerOnly={isPlayer}
            // Embedded mode = full-screen player scaled to the iframe viewport, with
            // branding instead of an exit-full-screen button. Used by the workshop
            // project page, which embeds this page in a small iframe.
            isEmbedded={isPlayer}
            canEditTitle={canSave}
            canSave={canSave}
            canRemix={canRemix}
            // With no project_id the default project shows "without id"; canCreateNew lets
            // the saver auto-create it on the server (POST) → redux projectId set →
            // onUpdateProjectId reflects the new id into the URL. With a project_id it
            // loads instead (showing "with id"), so this never double-creates.
            canCreateNew={canSave}
            projectId={projectId}
            projectTitle={title || 'Untitled'}
            projectHost={sessionId ?
                `${api}/store/ws/${slug}/sessions/${sessionId}/projects` :
                `${api}/store/ws/${slug}/projects`}
            assetHost={`${api}/store/ws/${slug}/assets`}
            // Backpack is per-participant per-workshop (not per-session): the server
            // ignores the username path segment and resolves the participant from the
            // cookie session or the ?token= that backpack-api sends as x-token.
            backpackHost={`${api}/store/ws/${slug}/backpack`}
            backpackVisible={!isPlayer}
            projectToken={token}
            versionTimestamp={version}
            onUpdateProjectId={updateProjectIdInUrl}
            onClickLogo={onClickLogo}
            enableCommunity={false}
        />
    );
};
