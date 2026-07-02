import React from 'react';
import ReactDomClient from 'react-dom/client';

import AppStateHOC from '../lib/app-state-hoc.jsx';
import GUI from '../containers/gui.jsx';
import log from '../lib/log.js';

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
 *   api         (optional) API origin; default '' = relative (same-origin via dev proxy)
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
        roomId: q.get('room_id')
    };
};

// Reflect the freshly-created project id into the URL so a reload exercises the
// load (GET) / update (PUT) paths. Skip the default id (it's not a real saved project).
const updateProjectIdInUrl = id => {
    if (id === null || String(id) === DEFAULT_PROJECT_ID) return;
    const url = new URL(window.location.href);
    url.searchParams.set('project_id', String(id));
    window.history.replaceState(null, '', url.toString());
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

    const {slug, projectId, token, api, nickname, code, isPlayer, roomId} = getParams();
    if (!slug) {
      log.error('Xcratch Workshop: missing required ?slug= query param');
    }

    await maybeJoin({api, slug, nickname, code});

    const WrappedGui = AppStateHOC(GUI);

    const root = ReactDomClient.createRoot(appTarget);

    root.render(
      <WrappedGui
        isPlayerOnly={isPlayer}
        // Embedded mode = full-screen player scaled to the iframe viewport, with
        // branding instead of an exit-full-screen button. Used by the workshop
        // project page, which embeds this page in a small iframe.
        isEmbedded={isPlayer}
        canEditTitle={!isPlayer}
        canSave={!isPlayer}
        // With no project_id the default project shows "without id"; canCreateNew lets
        // the saver auto-create it on the server (POST) → redux projectId set →
        // onUpdateProjectId reflects the new id into the URL. With a project_id it
        // loads instead (showing "with id"), so this never double-creates.
        canCreateNew={!isPlayer}
        projectId={projectId}
        projectHost={roomId ? `${api}/store/ws/${slug}/rooms/${roomId}/projects` : `${api}/store/ws/${slug}/projects`}
        assetHost={`${api}/store/ws/${slug}/assets`}
        projectToken={token}
        onUpdateProjectId={updateProjectIdInUrl}
        onClickLogo={onClickLogo}
        enableCommunity={false}
      />
    );
};
