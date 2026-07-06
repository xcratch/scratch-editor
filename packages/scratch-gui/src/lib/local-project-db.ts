/**
 * Thin promise wrapper around IndexedDB for storing Scratch projects locally.
 * Schema (all in one database):
 *   headers  (keyPath: id)                    - lightweight metadata for fast list rendering
 *   bodies   (keyPath: id)                    - current project.json per project
 *   assets   (keyPath: md5ext)                - costume/sound binaries, shared across projects
 *   versions (keyPath: [projectId, timestamp]) - historical snapshots of project.json
 */

import {VersionDiff} from './project-diff';

const DB_NAME = 'xcratch-local-projects';
const DB_VERSION = 1;

export const HEADERS_STORE = 'headers';
export const BODIES_STORE = 'bodies';
export const ASSETS_STORE = 'assets';
export const VERSIONS_STORE = 'versions';

export interface ProjectHeader {
    id: string;
    name: string;
    thumbnail: Blob | null;
    created: number;
    modified: number;
    // Free-form user note shown in the project list. Editing it does not
    // touch `modified` (it is not project content). Absent on records from
    // older builds.
    comment?: string;
}

export interface ProjectBody {
    id: string;
    body: string;
}

export interface StoredAsset {
    md5ext: string;
    assetId: string;
    dataFormat: string;
    assetTypeName: string;
    data: Uint8Array | string;
    modified: number;
}

export interface ProjectVersion {
    projectId: string;
    timestamp: number;
    parentTimestamp?: number | null;
    body: string;
    // Stage snapshot at the time of the save; patched in right after the
    // save by saveProjectThumbnail. Absent on records from older builds.
    thumbnail?: Blob | null;
    // Free-form user note shown in the version history view. Absent on
    // records from older builds.
    comment?: string;
    diff?: VersionDiff;
    isKeep?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HEADERS_STORE)) {
                db.createObjectStore(HEADERS_STORE, {keyPath: 'id'});
            }
            if (!db.objectStoreNames.contains(BODIES_STORE)) {
                db.createObjectStore(BODIES_STORE, {keyPath: 'id'});
            }
            if (!db.objectStoreNames.contains(ASSETS_STORE)) {
                db.createObjectStore(ASSETS_STORE, {keyPath: 'md5ext'});
            }
            if (!db.objectStoreNames.contains(VERSIONS_STORE)) {
                db.createObjectStore(VERSIONS_STORE, {keyPath: ['projectId', 'timestamp']});
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            // If another tab upgrades the schema, close so it can proceed.
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => {
            dbPromise = null;
            reject(request.error ?? new Error('IndexedDB open failed'));
        };
        request.onblocked = () => {
            // Another tab holds an old connection; the open will proceed once it closes.
        };
    });
    return dbPromise;
};

const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });

const promisifyTransaction = (tx: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });

const withStore = async <T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
    const db = await openDB();
    const tx = db.transaction(storeName, mode);
    const result = promisifyRequest(fn(tx.objectStore(storeName)));
    await promisifyTransaction(tx);
    return result;
};

const versionRange = (projectId: string): IDBKeyRange =>
    IDBKeyRange.bound([projectId, 0], [projectId, Infinity]);

export const getHeader = (id: string): Promise<ProjectHeader | undefined> =>
    withStore(HEADERS_STORE, 'readonly', store => store.get(id));

export const listHeaders = async (): Promise<ProjectHeader[]> => {
    const headers = await withStore<ProjectHeader[]>(HEADERS_STORE, 'readonly', store => store.getAll());
    return headers.sort((a, b) => b.modified - a.modified);
};

export const putHeader = (header: ProjectHeader): Promise<IDBValidKey> =>
    withStore(HEADERS_STORE, 'readwrite', store => store.put(header));

export const getBody = (id: string): Promise<ProjectBody | undefined> =>
    withStore(BODIES_STORE, 'readonly', store => store.get(id));

export const putBody = (body: ProjectBody): Promise<IDBValidKey> =>
    withStore(BODIES_STORE, 'readwrite', store => store.put(body));

export const getAllBodies = (): Promise<ProjectBody[]> =>
    withStore(BODIES_STORE, 'readonly', store => store.getAll());

export const getAsset = (md5ext: string): Promise<StoredAsset | undefined> =>
    withStore(ASSETS_STORE, 'readonly', store => store.get(md5ext));

export const putAsset = (asset: StoredAsset): Promise<IDBValidKey> =>
    withStore(ASSETS_STORE, 'readwrite', store => store.put(asset));

export const listAssetKeys = (): Promise<string[]> =>
    withStore(ASSETS_STORE, 'readonly', store => store.getAllKeys()) as Promise<string[]>;

export const deleteAssets = async (md5exts: string[]): Promise<void> => {
    if (md5exts.length === 0) return;
    const db = await openDB();
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    const store = tx.objectStore(ASSETS_STORE);
    md5exts.forEach(md5ext => store.delete(md5ext));
    await promisifyTransaction(tx);
};

export const putVersion = (version: ProjectVersion): Promise<IDBValidKey> =>
    withStore(VERSIONS_STORE, 'readwrite', store => store.put(version));

export const getVersion = (projectId: string, timestamp: number): Promise<ProjectVersion | undefined> =>
    withStore(VERSIONS_STORE, 'readonly', store => store.get([projectId, timestamp]));

export const listVersions = async (projectId: string): Promise<ProjectVersion[]> => {
    const versions = await withStore<ProjectVersion[]>(
        VERSIONS_STORE, 'readonly', store => store.getAll(versionRange(projectId)));
    return versions.sort((a, b) => b.timestamp - a.timestamp);
};

export const deleteVersions = async (keys: Array<[string, number]>): Promise<void> => {
    if (keys.length === 0) return;
    const db = await openDB();
    const tx = db.transaction(VERSIONS_STORE, 'readwrite');
    const store = tx.objectStore(VERSIONS_STORE);
    keys.forEach(key => store.delete(key));
    await promisifyTransaction(tx);
};

export const getAllVersionBodies = (): Promise<ProjectVersion[]> =>
    withStore(VERSIONS_STORE, 'readonly', store => store.getAll());

/*
 * Delete a project's header, body and all its versions in one transaction.
 * Orphaned assets are collected separately (see LocalProjectStorage).
 */
export const deleteProject = async (id: string): Promise<void> => {
    const db = await openDB();
    const tx = db.transaction([HEADERS_STORE, BODIES_STORE, VERSIONS_STORE], 'readwrite');
    tx.objectStore(HEADERS_STORE).delete(id);
    tx.objectStore(BODIES_STORE).delete(id);
    tx.objectStore(VERSIONS_STORE).delete(versionRange(id));
    await promisifyTransaction(tx);
};
