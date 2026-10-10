import {Asset} from 'scratch-storage';

import {LegacyStorage} from './legacy-storage';
import log from './log';
import {ProjectId, ProjectVersionItem, VersionDiff} from '../gui-config';

/*
 * Server-side shape of a single version-history entry, as returned by
 * GET {projectHost}/{id}/versions (see the backend API contract).
 */
interface ServerVersionItem {
    timestamp: number;
    parentTimestamp: number | null;
    comment: string;
    isKeep: boolean;
    diff: VersionDiff;
    hasThumbnail: boolean;
}

/*
 * How long a freshly created version waits for its thumbnail upload to be
 * started before we give up waiting (the thumbnail is not always requested,
 * e.g. when the renderer is unavailable), and how long to pause before the
 * single retry of a failed thumbnail upload.
 */
const THUMBNAIL_START_TIMEOUT_MS = 5000;
const THUMBNAIL_RETRY_DELAY_MS = 500;

interface PendingThumbnail {
    promise: Promise<void>;
    settle: () => void;
}

interface ListVersionsResponse {
    versions: ServerVersionItem[];
    canManage: boolean;
}

/*
 * ScratchStorage-compatible storage backed by the xcratch-workshop backend
 * (Prisma), used by the workshop launch adapter (render-workshop-gui.jsx).
 * Extends LegacyStorage (project/asset CRUD over HTTP) and adds the
 * server-backed version-history API described in the backend contract.
 *
 * listProjects / duplicateProject / deleteProject are intentionally NOT
 * implemented: the embedded editor always shows exactly one project, so
 * there is no "project list" concept here. Callers (menu-bar.jsx,
 * containers/project-library.jsx) feature-detect these methods to tell
 * LocalProjectStorage and WorkshopProjectStorage apart.
 */
export class WorkshopProjectStorage extends LegacyStorage {
    // Timestamp of the version created by the most recent saveProject() call,
    // per project id. Undefined when the last save didn't create a new
    // version (body unchanged). saveProjectThumbnail() reads this to know
    // which version the incoming thumbnail belongs to.
    private readonly lastVersionTimestamp = new Map<string, number>();

    // Thumbnails that were announced by a save (a version was created) but whose
    // upload has not finished yet, keyed by `${projectId}/${timestamp}`. The
    // embedding page waits for these (see waitForPendingThumbnail) before it
    // destroys the iframe, otherwise the in-flight PUT is aborted and the version
    // is left without a thumbnail.
    private readonly pendingThumbnails = new Map<string, PendingThumbnail>();

    // Cached from the last listVersions() response, per project id, so
    // canManageVersions() can be answered synchronously.
    private readonly canManageCache = new Map<string, boolean>();

    // When set, getProjectGetConfig serves this version's body instead of
    // the project's current body (see setVersionOverride).
    private versionOverride: number | null = null;

    setVersionOverride (timestamp: number | null): void {
        this.versionOverride = timestamp;
    }

    async saveProject (
        projectId: number,
        vmState: string,
        params: {originalId: string; isCopy: boolean; isRemix: boolean; title: string}
    ): Promise<{id: string | number}> {
        const result = await super.saveProject(projectId, vmState, params);
        // The PUT/POST response includes versionTimestamp only when a new
        // version was actually created (body changed); see backend contract.
        const versionTimestamp = (result as {versionTimestamp?: number}).versionTimestamp;
        if (typeof versionTimestamp === 'number') {
            this.lastVersionTimestamp.set(String(result.id), versionTimestamp);
            this.expectThumbnail(String(result.id), versionTimestamp);
        } else {
            this.lastVersionTimestamp.delete(String(result.id));
        }
        return result;
    }

    async saveProjectThumbnail (projectId: ProjectId, thumbnail: Blob): Promise<void> {
        const id = String(projectId);
        const timestamp = this.lastVersionTimestamp.get(id);
        // No version was created by the last save (body unchanged): there is
        // no version to attach this thumbnail to, so skip the request.
        if (typeof timestamp === 'undefined') return;
        if (!this.projectHost) return;
        try {
            await this.putThumbnail(id, timestamp, thumbnail);
        } finally {
            this.settleThumbnail(id, timestamp);
        }
    }

    /*
     * Resolves once the thumbnails of the versions created by recent saves have
     * been uploaded (successfully or not), or after timeoutMs. Resolves
     * immediately when nothing is pending. The workshop save bridge awaits this
     * before reporting a save as finished to the embedding page.
     */
    async waitForPendingThumbnail (timeoutMs = 10000): Promise<void> {
        if (this.pendingThumbnails.size === 0) return;
        const pending = Array.from(this.pendingThumbnails.values()).map(entry => entry.promise);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>(resolve => {
            timer = setTimeout(resolve, timeoutMs);
        });
        try {
            await Promise.race([Promise.all(pending), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    /*
     * PUTs the thumbnail, retrying once after a short pause when the request
     * fails (network error or non-2xx). Failures are logged, never thrown: a
     * missing thumbnail must not turn a successful save into an error.
     */
    private async putThumbnail (id: string, timestamp: number, thumbnail: Blob): Promise<void> {
        const url = this.withAuth(`${this.projectHost}/${id}/versions/${timestamp}/thumbnail`);
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const res = await fetch(url, {
                    method: 'PUT',
                    credentials: 'include',
                    body: thumbnail
                });
                if (res.ok) return;
                log.warn(`Failed to save thumbnail (attempt ${attempt}): ${res.status}`);
            } catch (e) {
                log.warn(`Failed to save thumbnail (attempt ${attempt}):`, e);
            }
            if (attempt < 2) {
                await new Promise(resolve => setTimeout(resolve, THUMBNAIL_RETRY_DELAY_MS));
            }
        }
    }

    // Registers a thumbnail that is expected to be uploaded for this version. It
    // settles when the upload finishes or, if saveProjectThumbnail is never
    // called, after THUMBNAIL_START_TIMEOUT_MS.
    private expectThumbnail (id: string, timestamp: number): void {
        const key = `${id}/${timestamp}`;
        this.pendingThumbnails.get(key)?.settle();
        let settle: () => void = () => {};
        const promise = new Promise<void>(resolve => {
            settle = resolve;
        });
        const timer = setTimeout(() => this.settleThumbnail(id, timestamp), THUMBNAIL_START_TIMEOUT_MS);
        const entry: PendingThumbnail = {
            promise,
            settle: () => {
                clearTimeout(timer);
                settle();
            }
        };
        this.pendingThumbnails.set(key, entry);
        // Drop the entry once settled, but only if it wasn't replaced meanwhile.
        promise.then(() => {
            if (this.pendingThumbnails.get(key) === entry) this.pendingThumbnails.delete(key);
        });
    }

    private settleThumbnail (id: string, timestamp: number): void {
        this.pendingThumbnails.get(`${id}/${timestamp}`)?.settle();
    }

    /*
     * Force-saves a new version with a comment and keep flag set at
     * creation time. Called by project-saver-hoc, either from an extension
     * block (runtime.saveProjectVersion) or the "Save with a comment" menu
     * item. Unlike saveProject, the server always creates a new version here
     * even if the body is unchanged.
     */
    async saveVersionWithMeta (
        projectId: ProjectId,
        vmState: string,
        meta: {comment?: string; isKeep?: boolean}
    ): Promise<{id: ProjectId; timestamp: number}> {
        if (!this.projectHost) throw new Error('Project host not set');
        const qs = new URLSearchParams();
        if (meta.comment) qs.set('comment', meta.comment);
        if (typeof meta.isKeep === 'boolean') qs.set('isKeep', String(meta.isKeep));
        const query = qs.toString();
        const url = this.withAuth(`${this.projectHost}/${projectId}/versions${query ? `?${query}` : ''}`);
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: vmState
        });
        if (!res.ok) throw new Error(`Failed to save version: ${res.status}`);
        const {versionTimestamp} = await res.json();
        // Record the new version's timestamp so the saveProjectThumbnail call
        // that project-saver-hoc issues right after this PUTs the thumbnail
        // onto this version rather than a stale one.
        this.lastVersionTimestamp.set(String(projectId), versionTimestamp);
        this.expectThumbnail(String(projectId), versionTimestamp);
        return {id: projectId, timestamp: versionTimestamp};
    }

    async listVersions (id: ProjectId): Promise<ProjectVersionItem[]> {
        if (!this.projectHost) return [];
        const res = await fetch(this.withAuth(`${this.projectHost}/${id}/versions`), {
            credentials: 'include'
        });
        if (!res.ok) throw new Error(`Failed to list versions: ${res.status}`);
        const data: ListVersionsResponse = await res.json();
        this.canManageCache.set(String(id), Boolean(data.canManage));

        return Promise.all(data.versions.map(async version => ({
            timestamp: version.timestamp,
            parentTimestamp: version.parentTimestamp ?? null,
            thumbnail: version.hasThumbnail ? await this.fetchThumbnail(id, version.timestamp) : null,
            comment: version.comment || '',
            diff: version.diff,
            isKeep: Boolean(version.isKeep)
        })));
    }

    async getVersionBody (id: ProjectId, timestamp: number): Promise<string | undefined> {
        if (!this.projectHost) return;
        const res = await fetch(this.withAuth(`${this.projectHost}/${id}/versions/${timestamp}`), {
            credentials: 'include'
        });
        if (!res.ok) return;
        return res.text();
    }

    async restoreVersion (id: ProjectId, timestamp: number, options?: {saveCurrent?: boolean}): Promise<string> {
        if (!this.projectHost) throw new Error('Project host not set');
        const saveCurrent = options?.saveCurrent !== false;
        const url = this.withAuth(
            `${this.projectHost}/${id}/versions/${timestamp}/restore?saveCurrent=${saveCurrent}`
        );
        const res = await fetch(url, {method: 'POST', credentials: 'include'});
        if (!res.ok) throw new Error(`Failed to restore version ${timestamp}: ${res.status}`);
        return res.text();
    }

    async setVersionComment (id: ProjectId, timestamp: number, comment: string): Promise<void> {
        await this.patchVersion(id, timestamp, {comment});
    }

    async setVersionKeep (id: ProjectId, timestamp: number, isKeep: boolean): Promise<void> {
        await this.patchVersion(id, timestamp, {isKeep});
    }

    async deleteVersion (id: ProjectId, timestamp: number): Promise<void> {
        if (!this.projectHost) return;
        const res = await fetch(this.withAuth(`${this.projectHost}/${id}/versions/${timestamp}`), {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) throw new Error(`Failed to delete version ${timestamp}: ${res.status}`);
    }

    canManageVersions (id: ProjectId): boolean {
        return this.canManageCache.get(String(id)) ?? false;
    }

    /*
     * Build a URL to open a past version in a new tab as a player
     * (?is_player=true). See buildVersionUrl for the common parts.
     */
    getVersionPlayerUrl (id: ProjectId, timestamp: number): string {
        return this.buildVersionUrl(id, timestamp, {player: true});
    }

    /*
     * Build a URL to open a past version in a new tab in the editor view
     * ("see inside": code visible but read-only - render-workshop-gui.jsx
     * forces canSave/canRemix/canEditTitle off whenever ?version= is set).
     */
    getVersionEditorUrl (id: ProjectId, timestamp: number): string {
        return this.buildVersionUrl(id, timestamp, {player: false});
    }

    /*
     * Common URL builder for opening a past version read-only. Reuses the
     * current page's slug/api/room_id/token query params so the new tab can
     * reach the same workshop/room.
     */
    private buildVersionUrl (id: ProjectId, timestamp: number, options: {player: boolean}): string {
        const current = new URLSearchParams(window.location.search);
        const params = new URLSearchParams();
        const slug = current.get('slug');
        if (slug) params.set('slug', slug);
        const api = current.get('api');
        if (api) params.set('api', api);
        const roomId = current.get('room_id');
        if (roomId) params.set('room_id', roomId);
        params.set('project_id', String(id));
        params.set('mode', 'remix');
        if (options.player) params.set('is_player', 'true');
        params.set('version', String(timestamp));
        const token = current.get('token');
        if (token) params.set('token', token);
        return `workshop.html?${params.toString()}`;
    }

    protected getProjectGetConfig (projectAsset: Asset): string {
        if (/^(http|https):\/\//.test(String(projectAsset.assetId))) {
            return String(projectAsset.assetId);
        }
        if (this.versionOverride !== null) {
            return this.withAuth(`${this.projectHost}/${projectAsset.assetId}/versions/${this.versionOverride}`);
        }
        return super.getProjectGetConfig(projectAsset);
    }

    private async fetchThumbnail (id: ProjectId, timestamp: number): Promise<Blob | null> {
        if (!this.projectHost) return null;
        try {
            const res = await fetch(this.withAuth(`${this.projectHost}/${id}/versions/${timestamp}/thumbnail`), {
                credentials: 'include'
            });
            if (!res.ok) return null;
            return await res.blob();
        } catch {
            return null;
        }
    }

    private async patchVersion (id: ProjectId, timestamp: number, body: {comment?: string; isKeep?: boolean}) {
        if (!this.projectHost) return;
        await fetch(this.withAuth(`${this.projectHost}/${id}/versions/${timestamp}`), {
            method: 'PATCH',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
    }

    private withAuth (url: string): string {
        if (!this.projectToken) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}token=${encodeURIComponent(this.projectToken)}`;
    }
}
