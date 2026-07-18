import {Asset} from 'scratch-storage';

import {LegacyStorage} from './legacy-storage';
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
        await fetch(this.withAuth(`${this.projectHost}/${id}/versions/${timestamp}/thumbnail`), {
            method: 'PUT',
            credentials: 'include',
            body: thumbnail
        });
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
