/**
 * Backup and restore of projects saved in the browser (IndexedDB).
 * A backup is a zip holding everything LocalProjectStorage keeps for a
 * project - header, current body, every version and their thumbnails - plus
 * the assets those bodies reference:
 *   manifest.json                    metadata (see BackupManifest)
 *   projects/<id>/project.json       current body
 *   projects/<id>/thumbnail          header thumbnail
 *   projects/<id>/versions/<ts>.json version body
 *   projects/<id>/versions/<ts>      version thumbnail
 *   assets/<md5ext>                  costume/sound binaries
 */

import JSZip from 'jszip';

import * as db from './local-project-db';
import {VersionDiff} from './project-diff';

export const BACKUP_FORMAT = 'xcratch-local-projects-backup';
export const BACKUP_FORMAT_VERSION = 1;

interface BackupVersion {
    timestamp: number;
    parentTimestamp: number | null;
    comment: string;
    isKeep: boolean;
    diff?: VersionDiff;
    // MIME type of the stored thumbnail, null when there is none
    thumbnailType: string | null;
}

interface BackupProject {
    id: string;
    name: string;
    comment: string;
    created: number;
    modified: number;
    thumbnailType: string | null;
    versions: BackupVersion[];
}

interface BackupAsset {
    assetId: string;
    dataFormat: string;
    assetTypeName: string;
}

interface BackupManifest {
    format: string;
    formatVersion: number;
    exported: number;
    projects: BackupProject[];
    assets: Record<string, BackupAsset>;
}

// Loads an asset that is not stored in IndexedDB (e.g. a library costume
// served from the CDN). Resolves null when it cannot be found.
export type AssetLoader =
    (assetTypeName: string, assetId: string, dataFormat: string) => Promise<Uint8Array | string | null>;

const projectDir = (id: string) => `projects/${id}`;

/*
 * Collect the assets referenced by a project.json body, with the type
 * information needed to load them through ScratchStorage.
 */
const collectAssets = (body: string, assets: Record<string, BackupAsset>): void => {
    let json;
    try {
        json = JSON.parse(body);
    } catch {
        return;
    }
    const add = (item: {md5ext?: string; assetId: string; dataFormat: string}, assetTypeName: string) => {
        const md5ext = item.md5ext || `${item.assetId}.${item.dataFormat}`;
        if (!assets[md5ext]) assets[md5ext] = {assetId: item.assetId, dataFormat: item.dataFormat, assetTypeName};
    };
    for (const target of json.targets || []) {
        for (const costume of target.costumes || []) {
            add(costume, costume.dataFormat === 'svg' ? 'ImageVector' : 'ImageBitmap');
        }
        for (const sound of target.sounds || []) add(sound, 'Sound');
    }
};

const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
        reader.readAsArrayBuffer(blob);
    });
};

const addThumbnail = async (zip: JSZip, path: string, thumbnail: Blob | null | undefined): Promise<string | null> => {
    if (!thumbnail) return null;
    zip.file(path, await blobToArrayBuffer(thumbnail));
    return thumbnail.type || 'image/png';
};

const readThumbnail = async (zip: JSZip, path: string, type: string | null): Promise<Blob | null> => {
    if (!type) return null;
    const file = zip.file(path);
    if (!file) return null;
    return new Blob([await file.async('arraybuffer')], {type});
};

/*
 * Build a backup zip of the given projects. Ids with no stored project are
 * ignored. Assets that are neither in IndexedDB nor loadable are left out
 * and counted in missingAssets.
 */
export const exportBackup = async (
    ids: string[],
    loadAsset: AssetLoader
): Promise<{blob: Blob; projectCount: number; missingAssets: number}> => {
    const zip = new JSZip();
    const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        exported: Date.now(),
        projects: [],
        assets: {}
    };
    const referenced: Record<string, BackupAsset> = {};

    for (const id of ids) {
        const [header, body, versions] = await Promise.all([
            db.getHeader(id), db.getBody(id), db.listVersions(id)
        ]);
        if (!header || !body) continue;
        const dir = projectDir(id);
        zip.file(`${dir}/project.json`, body.body);
        collectAssets(body.body, referenced);
        const project: BackupProject = {
            id,
            name: header.name,
            comment: header.comment || '',
            created: header.created,
            modified: header.modified,
            thumbnailType: await addThumbnail(zip, `${dir}/thumbnail`, header.thumbnail),
            versions: []
        };
        for (const version of versions) {
            zip.file(`${dir}/versions/${version.timestamp}.json`, version.body);
            collectAssets(version.body, referenced);
            project.versions.push({
                timestamp: version.timestamp,
                parentTimestamp: version.parentTimestamp ?? null,
                comment: version.comment || '',
                isKeep: Boolean(version.isKeep),
                diff: version.diff,
                thumbnailType: await addThumbnail(zip, `${dir}/versions/${version.timestamp}`, version.thumbnail)
            });
        }
        manifest.projects.push(project);
    }

    let missingAssets = 0;
    for (const [md5ext, meta] of Object.entries(referenced)) {
        const stored = await db.getAsset(md5ext);
        let data: Uint8Array | string | null = stored ? stored.data : null;
        if (stored) {
            manifest.assets[md5ext] = {
                assetId: stored.assetId,
                dataFormat: stored.dataFormat,
                assetTypeName: stored.assetTypeName
            };
        } else {
            try {
                data = await loadAsset(meta.assetTypeName, meta.assetId, meta.dataFormat);
            } catch {
                data = null;
            }
            if (data) manifest.assets[md5ext] = meta;
        }
        if (data) {
            zip.file(`assets/${md5ext}`, data);
        } else {
            missingAssets++;
        }
    }

    zip.file('manifest.json', JSON.stringify(manifest));
    const blob = await zip.generateAsync({type: 'blob', mimeType: 'application/zip'});
    return {blob, projectCount: manifest.projects.length, missingAssets};
};

/*
 * Restore the projects in a backup zip. A project whose id is free keeps
 * it; one already stored with the same `modified` is skipped (re-importing
 * the same backup adds nothing); any other id clash gets a new id from
 * `generateId`, so stored projects are never overwritten.
 */
export const importBackup = async (
    file: Blob | ArrayBuffer | Uint8Array,
    generateId: () => Promise<string>
): Promise<{imported: number; skipped: number}> => {
    let zip: JSZip;
    let manifest: BackupManifest;
    try {
        zip = await JSZip.loadAsync(file);
        const manifestFile = zip.file('manifest.json');
        manifest = manifestFile ? JSON.parse(await manifestFile.async('string')) : null;
    } catch {
        throw new Error('Not an Xcratch project backup');
    }
    if (!manifest || manifest.format !== BACKUP_FORMAT) {
        throw new Error('Not an Xcratch project backup');
    }
    if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
        throw new Error(`Unsupported backup version: ${manifest.formatVersion}`);
    }

    // Assets first, so a restored project never references a missing one
    for (const [md5ext, meta] of Object.entries(manifest.assets || {})) {
        if (await db.getAsset(md5ext)) continue;
        const assetFile = zip.file(`assets/${md5ext}`);
        if (!assetFile) continue;
        await db.putAsset({
            md5ext,
            assetId: meta.assetId,
            dataFormat: meta.dataFormat,
            assetTypeName: meta.assetTypeName,
            data: await assetFile.async('uint8array'),
            modified: Date.now()
        });
    }

    let imported = 0;
    let skipped = 0;
    for (const project of manifest.projects || []) {
        const dir = projectDir(project.id);
        const bodyFile = zip.file(`${dir}/project.json`);
        if (!bodyFile) {
            skipped++;
            continue;
        }
        const existing = await db.getHeader(project.id);
        if (existing && existing.modified === project.modified) {
            skipped++;
            continue;
        }
        const id = existing ? await generateId() : project.id;
        for (const version of project.versions || []) {
            const versionFile = zip.file(`${dir}/versions/${version.timestamp}.json`);
            if (!versionFile) continue;
            await db.putVersion({
                projectId: id,
                timestamp: version.timestamp,
                parentTimestamp: version.parentTimestamp,
                body: await versionFile.async('string'),
                thumbnail: await readThumbnail(zip, `${dir}/versions/${version.timestamp}`, version.thumbnailType),
                comment: version.comment,
                isKeep: version.isKeep,
                diff: version.diff
            });
        }
        await db.putBody({id, body: await bodyFile.async('string')});
        // Header last: the project appears in the list only once complete
        await db.putHeader({
            id,
            name: project.name,
            comment: project.comment,
            created: project.created,
            modified: project.modified,
            thumbnail: await readThumbnail(zip, `${dir}/thumbnail`, project.thumbnailType)
        });
        imported++;
    }
    return {imported, skipped};
};
