import {ScratchStorage, Asset, AssetType, DataFormat, Helper} from 'scratch-storage';

import defaultProject from './default-project';
import {GUIStorage, ProjectId, ProjectVersionItem, TranslatorFunction} from '../gui-config';

import * as db from './local-project-db';
import {computeVersionDiff} from './project-diff';

const LAST_PROJECT_KEY = 'xcratch:lastLocalProjectId';

// Minimum time between orphaned-asset sweeps triggered by version thinning
const GC_MIN_INTERVAL_MS = 10 * 60 * 1000;

const VERSION_CAP_PER_PROJECT = 40;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const isLocalProjectId = (id: unknown): boolean =>
    /^\d+$/.test(String(id)) && String(id) !== '0';

/*
 * Generate a new numeric project id. Numeric ids are required so that
 * HashParserHOC can round-trip them through the URL hash (`#<id>`).
 */
export const generateProjectId = async (): Promise<string> => {
    let candidate = Date.now();
    while (await db.getHeader(String(candidate))) candidate++;
    return String(candidate);
};

/*
 * Collect the md5exts of all assets referenced by a project.json body.
 */
export const extractReferencedAssets = (body: string, referenced: Set<string>): void => {
    let json;
    try {
        json = JSON.parse(body);
    } catch {
        return;
    }
    for (const target of json.targets || []) {
        for (const costume of target.costumes || []) {
            referenced.add(costume.md5ext || `${costume.assetId}.${costume.dataFormat}`);
        }
        for (const sound of target.sounds || []) {
            referenced.add(sound.md5ext || `${sound.assetId}.${sound.dataFormat}`);
        }
    }
};

/*
 * Generation-based thinning: recent versions are kept densely, older ones sparsely.
 * Given timestamps sorted newest-first, returns the timestamps to delete.
 */
export const selectVersionsToThin = (timestamps: number[], now: number): number[] => {
    const toDelete: number[] = [];
    const seenBuckets = new Set<string>();
    let kept = 0;
    for (const ts of timestamps) {
        const age = now - ts;
        let bucket: string | null = null;
        if (age <= 10 * MINUTE_MS) {
            bucket = null; // keep all
        } else if (age <= DAY_MS) {
            bucket = `h${Math.floor(ts / HOUR_MS)}`;
        } else if (age <= 30 * DAY_MS) {
            bucket = `d${Math.floor(ts / DAY_MS)}`;
        } else {
            bucket = `w${Math.floor(ts / WEEK_MS)}`;
        }
        if ((bucket !== null && seenBuckets.has(bucket)) || kept >= VERSION_CAP_PER_PROJECT) {
            toDelete.push(ts);
            continue;
        }
        if (bucket !== null) seenBuckets.add(bucket);
        kept++;
    }
    return toDelete;
};

/**
 * Serves locally saved projects and assets from IndexedDB.
 * Sits between the builtin (in-memory) helper and the web helper:
 * - a synchronous null return skips this helper (used for non-local project ids)
 * - a rejection falls through to the web helper (used for asset cache misses,
 *   so library assets still come from the CDN)
 * NOTE: resolving null would terminate the helper chain (see ScratchStorage.load),
 * so misses MUST reject.
 */
type ProjectLoadObserver = (id: string, modified: number) => void;

class IndexedDBHelper extends Helper {
    private readonly onProjectLoaded?: ProjectLoadObserver;

    constructor (parent: ScratchStorage, onProjectLoaded?: ProjectLoadObserver) {
        super(parent);
        this.onProjectLoaded = onProjectLoaded;
    }

    load (assetType: AssetType, assetId: string | number, dataFormat: DataFormat): Promise<Asset> | null {
        if (assetType.name === 'Project') {
            if (!isLocalProjectId(assetId)) return null;
            return db.getBody(String(assetId)).then(record => {
                if (!record) throw new Error(`Local project not found: ${assetId}`);
                // Remember which revision this tab loaded, for multi-tab
                // conflict detection at save time.
                db.getHeader(String(assetId)).then(header => {
                    if (header) this.onProjectLoaded?.(String(assetId), header.modified);
                });
                return new Asset(assetType, assetId, dataFormat, record.body);
            });
        }
        return db.getAsset(`${assetId}.${dataFormat}`).then(record => {
            if (!record) throw new Error(`Local asset not found: ${assetId}.${dataFormat}`);
            return new Asset(assetType, assetId, dataFormat, record.data);
        });
    }
}

/**
 * ScratchStorage whose writes go to IndexedDB.
 * store() must be overridden because the base class hard-routes it to webHelper.
 */
class LocalScratchStorage extends ScratchStorage {
    constructor (onProjectLoaded?: ProjectLoadObserver) {
        super();
        this.addHelper(new IndexedDBHelper(this, onProjectLoaded), 50);
    }

    store (
        assetType: AssetType,
        dataFormat: DataFormat | null | undefined,
        data: Uint8Array | string,
        assetId?: string | number
    ) {
        const format = dataFormat || assetType.runtimeFormat;
        return db.putAsset({
            md5ext: `${assetId}.${format}`,
            assetId: String(assetId),
            dataFormat: String(format),
            assetTypeName: assetType.name,
            data,
            modified: Date.now()
        }).then(() => {
            // Keep the in-memory cache in sync, as the base class does
            this.builtinHelper._store(assetType, format, data, assetId);
            return {'status': 'ok', 'id': String(assetId), 'content-name': String(assetId)};
        });
    }
}

export interface LocalProjectListItem {
    id: string;
    name: string;
    thumbnail: Blob | null;
    created: number;
    modified: number;
    comment?: string;
}

// Alias of the type shared with WorkshopProjectStorage (see gui-config.ts).
// Implementation below is unchanged; only the type declaration moved.
export type LocalProjectVersionItem = ProjectVersionItem;

export class LocalProjectStorage implements GUIStorage {
    readonly scratchStorage = new LocalScratchStorage((id, modified) => {
        this.knownModified.set(id, modified);
    });

    private assetHost?: string;
    private backpackHost?: string;
    private translator?: TranslatorFunction;
    private currentProjectId: string | null = null;
    private currentTitle: string | null = null;
    // Maps non-local ids ('0', 'https://...') to the local id created for them,
    // so repeated autosaves update one record instead of creating duplicates.
    private readonly aliases = new Map<string, string>();
    // Per project, the header.modified value this tab last read or wrote.
    // A mismatch with the stored header at save time means another tab
    // updated the project in the meantime (multi-tab conflict).
    private readonly knownModified = new Map<string, number>();
    // Timestamp of the version whose content is currently in the editor.
    // The thumbnail arrives after the save (saveProjectThumbnail), so it is
    // patched onto this version then.
    private readonly lastVersionTimestamp = new Map<string, number>();
    private lastGcTime = 0;
    // Per project id, the tail of the chain of in-flight writes. Used to
    // serialize read-modify-write sequences (header/version updates) so an
    // autosave and a forced saveVersionWithMeta targeting the same project
    // can never interleave.
    private readonly pendingWrites = new Map<string, Promise<unknown>>();

    constructor () {
        this.cacheDefaultProject();
        this.addGetOnlyWebStores();
    }

    setAssetHost (host: string): void {
        this.assetHost = host;
    }

    setProjectMetadata (projectId: string | null | undefined): void {
        const {RequestMetadata, setMetadata, unsetMetadata} = this.scratchStorage.scratchFetch;
        if (projectId && projectId !== '0') {
            setMetadata(RequestMetadata.ProjectId, projectId);
        } else {
            unsetMetadata(RequestMetadata.ProjectId);
        }
        this.currentProjectId = projectId ? String(projectId) : null;
    }

    setTranslatorFunction (translator: TranslatorFunction): void {
        this.translator = translator;
        this.cacheDefaultProject();
    }

    setBackpackHost (host: string): void {
        const shouldAddSource = !this.backpackHost && host !== 'localStorage';
        if (shouldAddSource) {
            const AssetTypes = this.scratchStorage.AssetType;
            this.scratchStorage.addWebStore(
                [AssetTypes.ImageVector, AssetTypes.ImageBitmap, AssetTypes.Sound],
                asset => `${this.backpackHost}/${asset.assetId}.${asset.dataFormat}`
            );
        }
        this.backpackHost = host;
    }

    async saveProject (
        projectId: ProjectId | null | undefined,
        vmState: string,
        params: {originalId?: ProjectId; isCopy?: boolean | 1; isRemix?: boolean | 1; title?: string}
    ): Promise<{id: ProjectId}> {
        const idString = projectId === null || typeof projectId === 'undefined' ? null : String(projectId);
        const hasLocalId = idString !== null && isLocalProjectId(idString);
        const aliasKey = idString !== null && !hasLocalId ? idString : null;
        const aliasedId = aliasKey === null ? null : this.aliases.get(aliasKey);
        const isCreate = Boolean(params.isCopy) || Boolean(params.isRemix) || (!hasLocalId && !aliasedId);

        // Id resolution/creation happens outside the queue: a brand new id is
        // not yet known to any other writer, and resolving an alias is a
        // synchronous map lookup.
        const id = isCreate ? await generateProjectId() : (hasLocalId ? (idString as string) : (aliasedId as string));

        return this.enqueueWrite(id, async () => {
            const now = Date.now();
            if (isCreate) {
                await db.putHeader({
                    id,
                    name: params.title || this.currentTitle || 'Untitled',
                    thumbnail: null,
                    comment: '',
                    created: now,
                    modified: now
                });
                if (aliasKey !== null && !params.isCopy && !params.isRemix) {
                    this.aliases.set(aliasKey, id);
                }
            } else {
                const header = await db.getHeader(id);
                if (header) {
                    header.modified = now;
                    // Sync the name with the current redux title: a save always
                    // happens while the project is being edited, and some title
                    // changes (e.g. from an .sb3 upload filename) arrive during
                    // loading states where the rename HOC doesn't persist them.
                    const newName = params.title || this.currentTitle;
                    if (newName) header.name = newName;
                    await db.putHeader(header);
                } else {
                    // Header vanished (e.g. deleted in another tab): recreate it
                    await db.putHeader({
                        id,
                        name: params.title || this.currentTitle || 'Untitled',
                        thumbnail: null,
                        comment: '',
                        created: now,
                        modified: now
                    });
                }
            }

            // Skip the version snapshot when the body is unchanged (e.g. a save
            // triggered right after a reload) to avoid duplicate history entries.
            const currentBody = isCreate ? null : await db.getBody(id);
            const bodyChanged = !currentBody || currentBody.body !== vmState;

            await db.putBody({id, body: vmState});
            if (bodyChanged) {
                let parentTs = this.lastVersionTimestamp.get(id);
                if (parentTs === undefined) {
                    const versions = await db.listVersions(id);
                    parentTs = versions.length > 0 ? versions[0].timestamp : undefined;
                }
                const parentTsFinal = parentTs || null;
                const diff = computeVersionDiff(currentBody ? currentBody.body : null, vmState);
                await db.putVersion({projectId: id, timestamp: now, parentTimestamp: parentTsFinal, body: vmState, thumbnail: null, diff});
                this.lastVersionTimestamp.set(id, now);
                await this.thinVersions(id, now);
            }
            this.knownModified.set(id, now);

            try {
                localStorage.setItem(LAST_PROJECT_KEY, id);
            } catch {
                // localStorage unavailable (private mode etc.) - resume-last just won't work
            }
            return {id};
        });
    }

    /*
     * Multi-tab conflict check: true when the stored header was modified
     * since this tab last read or wrote the project.
     */
    async hasConflict (projectId: ProjectId): Promise<boolean> {
        const id = this.resolveId(String(projectId));
        if (id === null) return false;
        const known = this.knownModified.get(id);
        if (typeof known === 'undefined') return false;
        const header = await db.getHeader(id);
        if (!header) return false;
        return header.modified !== known;
    }

    /*
     * Read the latest stored body and name of a project, marking that
     * revision as known to this tab (clears a pending conflict).
     */
    async readProject (projectId: ProjectId): Promise<{body: string; name: string} | null> {
        const id = this.resolveId(String(projectId));
        if (id === null) return null;
        const [body, header] = await Promise.all([db.getBody(id), db.getHeader(id)]);
        if (!body) return null;
        if (header) this.knownModified.set(id, header.modified);
        return {body: body.body, name: header ? header.name : ''};
    }

    async saveProjectThumbnail (projectId: ProjectId, thumbnail: Blob): Promise<void> {
        const id = this.resolveId(String(projectId));
        if (id === null) return;
        const header = await db.getHeader(id);
        if (!header) return;
        header.thumbnail = thumbnail;
        await db.putHeader(header);
        // Attach the thumbnail to the version whose content it captures
        // (the one written by the save that triggered this call).
        const versionTimestamp = this.lastVersionTimestamp.get(id);
        if (typeof versionTimestamp === 'undefined') return;
        const version = await db.getVersion(id, versionTimestamp);
        if (!version) return;
        version.thumbnail = thumbnail;
        await db.putVersion(version);
    }

    /*
     * Cache the current redux title without touching stored headers.
     * Used as the header name when a project record is first created.
     */
    noteProjectTitle (title: string): void {
        this.currentTitle = title;
    }

    /*
     * Persist a rename immediately. Renaming alone does not mark the project
     * as changed, so without this the new title would only reach the header
     * on the next content save.
     */
    async setProjectTitle (title: string): Promise<void> {
        this.currentTitle = title;
        const id = this.currentProjectId === null ? null : this.resolveId(this.currentProjectId);
        if (id === null) return;
        const header = await db.getHeader(id);
        if (!header || header.name === title) return;
        header.name = title;
        await db.putHeader(header);
    }

    listProjects (): Promise<LocalProjectListItem[]> {
        return db.listHeaders();
    }

    /*
     * Persist the free-form note shown in the project list. Comments are
     * not project content: `modified` is left untouched so a comment edit
     * neither reorders the list nor triggers multi-tab conflicts.
     */
    async setProjectComment (id: ProjectId, comment: string): Promise<void> {
        const header = await db.getHeader(String(id));
        if (!header || (header.comment || '') === comment) return;
        header.comment = comment;
        await db.putHeader(header);
    }

    getProjectHeader (id: ProjectId): Promise<LocalProjectListItem | undefined> {
        return db.getHeader(String(id));
    }

    async projectExists (id: ProjectId): Promise<boolean> {
        const header = await db.getHeader(String(id));
        return Boolean(header);
    }

    async deleteProject (id: ProjectId): Promise<void> {
        await db.deleteProject(String(id));
        await this.gcOrphanAssets();
    }

    /*
     * Duplicate a stored project without opening it: copies the header
     * (name overridable), current body and thumbnail under a new id.
     * Assets are shared by md5ext, so nothing else needs copying; the copy
     * starts with a fresh single-entry history.
     */
    async duplicateProject (id: ProjectId, newName?: string): Promise<{id: string}> {
        const idString = String(id);
        const [header, body] = await Promise.all([db.getHeader(idString), db.getBody(idString)]);
        if (!header || !body) throw new Error(`Local project not found: ${idString}`);
        const newId = await generateProjectId();
        const now = Date.now();
        await db.putHeader({
            id: newId,
            name: newName || header.name,
            thumbnail: header.thumbnail,
            created: now,
            modified: now,
            comment: header.comment || ''
        });
        await db.putBody({id: newId, body: body.body});
        await db.putVersion({projectId: newId, timestamp: now, parentTimestamp: null, body: body.body, thumbnail: header.thumbnail});
        this.knownModified.set(newId, now);
        this.lastVersionTimestamp.set(newId, now);
        return {id: newId};
    }

    async listVersions (id: ProjectId): Promise<LocalProjectVersionItem[]> {
        const versions = await db.listVersions(String(id));
        // Drop the (large) bodies; the list view only needs metadata
        return versions.map(({projectId, timestamp, parentTimestamp, thumbnail, comment, diff, isKeep}) => ({
            projectId,
            timestamp,
            parentTimestamp: parentTimestamp ?? null,
            thumbnail: thumbnail ?? null,
            comment: comment || '',
            diff,
            isKeep: isKeep || false
        }));
    }

    /*
     * Persist the free-form note shown in the version history view.
     * Like project comments, this is metadata and does not touch `modified`.
     * A commented version is excluded from automatic thinning.
     */
    async setVersionComment (id: ProjectId, timestamp: number, comment: string): Promise<void> {
        const version = await db.getVersion(String(id), timestamp);
        if (!version || (version.comment || '') === comment) return;
        version.comment = comment;
        await db.putVersion(version);
    }

    /*
     * Persist the keep status of a version. A kept version cannot be automatically
     * or manually deleted.
     */
    async setVersionKeep (id: ProjectId, timestamp: number, isKeep: boolean): Promise<void> {
        const version = await db.getVersion(String(id), timestamp);
        if (!version || Boolean(version.isKeep) === isKeep) return;
        version.isKeep = isKeep;
        await db.putVersion(version);
    }

    /*
     * Force-create a new version with a comment and keep flag set at
     * creation time (e.g. from an extension block via
     * runtime.saveProjectVersion). Unlike saveProject, a version snapshot is
     * always written even when the body is unchanged, so a checkpoint is
     * guaranteed to exist; setting comment/isKeep at creation also means
     * thinning never observes an un-kept moment for it.
     */
    async saveVersionWithMeta (
        projectId: ProjectId,
        vmState: string,
        meta: {comment?: string; isKeep?: boolean}
    ): Promise<{id: ProjectId; timestamp: number}> {
        const idString = String(projectId);
        const id = isLocalProjectId(idString) ? idString : this.aliases.get(idString);
        if (!id) throw new Error(`Local project not found: ${idString}`);

        return this.enqueueWrite(id, async () => {
            // Read the header inside the queue so a concurrent save's header
            // update (e.g. a title sync) is never overwritten with stale data.
            const header = await db.getHeader(id);
            if (!header) throw new Error(`Local project not found: ${id}`);
            const now = Date.now();
            const currentBody = await db.getBody(id);
            await db.putBody({id, body: vmState});

            let parentTs = this.lastVersionTimestamp.get(id);
            if (parentTs === undefined) {
                const versions = await db.listVersions(id);
                parentTs = versions.length > 0 ? versions[0].timestamp : undefined;
            }
            const parentTsFinal = parentTs || null;
            const diff = computeVersionDiff(currentBody ? currentBody.body : null, vmState);
            await db.putVersion({
                projectId: id,
                timestamp: now,
                parentTimestamp: parentTsFinal,
                body: vmState,
                thumbnail: null,
                comment: meta.comment || '',
                isKeep: Boolean(meta.isKeep),
                diff
            });
            this.lastVersionTimestamp.set(id, now);

            header.modified = now;
            await db.putHeader(header);
            this.knownModified.set(id, now);
            await this.thinVersions(id, now);

            try {
                localStorage.setItem(LAST_PROJECT_KEY, id);
            } catch {
                // localStorage unavailable (private mode etc.) - resume-last just won't work
            }
            return {id, timestamp: now};
        });
    }

    async getVersionBody (id: ProjectId, timestamp: number): Promise<string | undefined> {
        const version = await db.getVersion(String(id), timestamp);
        return version?.body;
    }

    /*
     * Make the given version the project's current body. The state being
     * replaced is snapshotted first, so restoring never loses work.
     * Resolves with the restored body so the caller can load it into the VM.
     */
    async restoreVersion (id: ProjectId, timestamp: number, options?: {saveCurrent?: boolean}): Promise<string> {
        const idString = String(id);
        const version = await db.getVersion(idString, timestamp);
        if (!version) throw new Error(`Version not found: ${idString}@${timestamp}`);

        const now = Date.now();
        const current = await db.getBody(idString);
        const header = await db.getHeader(idString);
        const shouldSaveCurrent = options?.saveCurrent !== false;

        if (shouldSaveCurrent && current && current.body !== version.body) {
            // The header thumbnail captures the last saved state, i.e. the
            // body being snapshotted here.
            const parentTs = this.lastVersionTimestamp.get(idString) || null;
            await db.putVersion({
                projectId: idString,
                timestamp: now,
                parentTimestamp: parentTs,
                body: current.body,
                thumbnail: header ? header.thumbnail : null
            });
        }
        await db.putBody({id: idString, body: version.body});
        if (header) {
            header.modified = now;
            if (version.thumbnail) header.thumbnail = version.thumbnail;
            await db.putHeader(header);
        }
        this.knownModified.set(idString, now);
        // The editor now shows the restored version's content; a thumbnail
        // generated by a subsequent save belongs to that version.
        this.lastVersionTimestamp.set(idString, timestamp);
        await this.thinVersions(idString, now);
        return version.body;
    }

    async deleteVersion (id: ProjectId, timestamp: number): Promise<void> {
        const idString = String(id);
        const versions = await db.listVersions(idString);
        
        const targetVersion = versions.find(v => v.timestamp === timestamp);
        if (!targetVersion) return;
        if (targetVersion.isKeep) {
            throw new Error(`Cannot delete version ${idString}@${timestamp} because it is kept`);
        }

        const toDeleteSet = new Set([timestamp]);

        const parentMap = new Map<number, number | null>();
        for (const v of versions) {
            parentMap.set(v.timestamp, v.parentTimestamp || null);
        }

        const getSurvivingAncestor = (ts: number): number | null => {
            let curr = parentMap.get(ts) || null;
            while (curr && toDeleteSet.has(curr)) {
                curr = parentMap.get(curr) || null;
            }
            return curr;
        };

        const reparentPromises: Array<Promise<unknown>> = [];
        for (const v of versions) {
            if (v.timestamp !== timestamp) {
                const pTs = v.parentTimestamp || null;
                if (pTs === timestamp) {
                    const newParentTs = getSurvivingAncestor(v.timestamp);
                    const newParentObj = newParentTs ? versions.find(ver => ver.timestamp === newParentTs) : null;
                    const oldBody = newParentObj ? newParentObj.body : null;
                    const newDiff = computeVersionDiff(oldBody, v.body);
                    
                    reparentPromises.push(db.putVersion({ ...v, parentTimestamp: newParentTs, diff: newDiff }));
                }
            }
        }
        await Promise.all(reparentPromises);
        await db.deleteVersions([[idString, timestamp]]);
    }

    private resolveId (id: string): string | null {
        if (isLocalProjectId(id)) return id;
        return this.aliases.get(id) ?? null;
    }

    /*
     * Run `fn` after any previously queued write for `id` has settled, so
     * concurrent read-modify-write sequences targeting the same project
     * (autosave vs. a forced saveVersionWithMeta, etc.) never interleave.
     */
    private enqueueWrite<T> (id: string, fn: () => Promise<T>): Promise<T> {
        const prior = this.pendingWrites.get(id) || Promise.resolve();
        const settled = prior.then(fn, fn);
        this.pendingWrites.set(id, settled.catch(() => undefined));
        return settled;
    }

    private async thinVersions (projectId: string, now: number): Promise<void> {
        const versions = await db.listVersions(projectId); // newest first
        let toDelete = selectVersionsToThin(versions.map(v => v.timestamp), now);
        if (toDelete.length === 0) return;

        // Count children for each version to identify branch parents (versions with >= 2 children)
        const childCounts = new Map<number, number>();
        for (const v of versions) {
            if (v.parentTimestamp) {
                childCounts.set(v.parentTimestamp, (childCounts.get(v.parentTimestamp) || 0) + 1);
            }
        }

        // Never auto-delete versions that serve as a branch parent, that are
        // marked as kept, or that carry a user comment
        toDelete = toDelete.filter(ts => {
            const version = versions.find(v => v.timestamp === ts);
            if (version && (version.isKeep || version.comment)) return false;
            return (childCounts.get(ts) || 0) < 2;
        });
        if (toDelete.length === 0) return;

        const toDeleteSet = new Set(toDelete);
        const parentMap = new Map<number, number | null>();
        for (const v of versions) {
            parentMap.set(v.timestamp, v.parentTimestamp || null);
        }

        const getSurvivingAncestor = (ts: number): number | null => {
            let curr = parentMap.get(ts) || null;
            while (curr && toDeleteSet.has(curr)) {
                curr = parentMap.get(curr) || null;
            }
            return curr;
        };

        const reparentPromises: Array<Promise<unknown>> = [];
        for (const v of versions) {
            if (!toDeleteSet.has(v.timestamp)) {
                const pTs = v.parentTimestamp || null;
                if (pTs && toDeleteSet.has(pTs)) {
                    const newParent = getSurvivingAncestor(v.timestamp);
                    reparentPromises.push(db.putVersion({ ...v, parentTimestamp: newParent }));
                }
            }
        }
        await Promise.all(reparentPromises);

        await db.deleteVersions(toDelete.map(ts => [projectId, ts]));
        // Thinned versions may have been the last reference to some assets.
        // Sweeping parses every stored body, so throttle it.
        if (now - this.lastGcTime >= GC_MIN_INTERVAL_MS) {
            await this.gcOrphanAssets();
        }
    }

    /**
     * Mark-and-sweep: delete assets referenced by no current body and no
     * version snapshot. Versions must be included so that restoring an old
     * version never finds its assets missing.
     */
    private async gcOrphanAssets (): Promise<void> {
        this.lastGcTime = Date.now();
        const referenced = new Set<string>();
        const [bodies, versions] = await Promise.all([db.getAllBodies(), db.getAllVersionBodies()]);
        for (const {body} of bodies) extractReferencedAssets(body, referenced);
        for (const {body} of versions) extractReferencedAssets(body, referenced);
        const allKeys = await db.listAssetKeys();
        await db.deleteAssets(allKeys.filter(key => !referenced.has(key)));
    }

    private cacheDefaultProject (): void {
        const defaultProjectAssets = defaultProject(this.translator);
        defaultProjectAssets.forEach(asset => this.scratchStorage.builtinHelper._store(
            this.scratchStorage.AssetType[asset.assetType],
            this.scratchStorage.DataFormat[asset.dataFormat],
            asset.data,
            asset.id
        ));
    }

    /**
     * Web stores are registered for reads only (writes go to IndexedDB via
     * LocalScratchStorage.store). They serve as fallback for library assets
     * and for `#https://...` shared project URLs.
     */
    private addGetOnlyWebStores (): void {
        const storage = this.scratchStorage;

        // Returning false from a get-config function makes WebHelper skip this
        // store (see WebHelper.load), but the UrlFunction type doesn't admit it.
        const projectGetConfig = ((projectAsset: Asset) => {
            // Only handle full URLs (Xcratch shared projects); local
            // numeric ids are served by the IndexedDB helper.
            if (/^(http|https):\/\//.test(String(projectAsset.assetId))) {
                return String(projectAsset.assetId);
            }
            return false;
        }) as unknown as Parameters<ScratchStorage['addWebStore']>[1];

        storage.addWebStore(
            [storage.AssetType.Project],
            projectGetConfig
        );

        storage.addWebStore(
            [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
            asset => `${this.assetHost}/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`
        );

        storage.addWebStore(
            [storage.AssetType.Sound],
            asset => `static/extension-assets/scratch3_music/${asset.assetId}.${asset.dataFormat}`
        );
    }
}

export const getLastLocalProjectId = (): string | null => {
    try {
        return localStorage.getItem(LAST_PROJECT_KEY);
    } catch {
        return null;
    }
};

export const setLastLocalProjectId = (id: string): void => {
    try {
        localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
        // ignore
    }
};

export const localProjectExists = async (id: string): Promise<boolean> => {
    if (!isLocalProjectId(id)) return false;
    const header = await db.getHeader(id);
    return Boolean(header);
};
