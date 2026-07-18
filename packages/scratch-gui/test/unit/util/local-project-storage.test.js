import {
    isLocalProjectId,
    extractReferencedAssets,
    selectVersionsToThin,
    LocalProjectStorage
} from '../../../src/lib/local-project-storage';

import * as db from '../../../src/lib/local-project-db';

jest.mock('../../../src/lib/local-project-db', () => ({
    getHeader: jest.fn(),
    listHeaders: jest.fn(),
    putHeader: jest.fn(),
    getBody: jest.fn(),
    putBody: jest.fn(),
    getAllBodies: jest.fn(),
    getAsset: jest.fn(),
    putAsset: jest.fn(),
    listAssetKeys: jest.fn(),
    deleteAssets: jest.fn(),
    putVersion: jest.fn(),
    getVersion: jest.fn(),
    listVersions: jest.fn(),
    deleteVersions: jest.fn(),
    getAllVersionBodies: jest.fn(),
    deleteProject: jest.fn()
}));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('isLocalProjectId', () => {
    test('accepts numeric string ids other than "0"', () => {
        expect(isLocalProjectId('1751400000000')).toBe(true);
        expect(isLocalProjectId(1751400000000)).toBe(true);
    });
    test('rejects "0", urls and empty values', () => {
        expect(isLocalProjectId('0')).toBe(false);
        expect(isLocalProjectId('https://example.com/p.sb3')).toBe(false);
        expect(isLocalProjectId(null)).toBe(false);
        expect(isLocalProjectId('')).toBe(false);
        expect(isLocalProjectId('abc123')).toBe(false);
    });
});

describe('extractReferencedAssets', () => {
    test('collects md5exts of costumes and sounds', () => {
        const referenced = new Set();
        const body = JSON.stringify({
            targets: [{
                costumes: [
                    {md5ext: 'aaa.svg'},
                    {assetId: 'bbb', dataFormat: 'png'}
                ],
                sounds: [{md5ext: 'ccc.wav'}]
            }, {
                costumes: [{md5ext: 'aaa.svg'}],
                sounds: []
            }]
        });
        extractReferencedAssets(body, referenced);
        expect([...referenced].sort()).toEqual(['aaa.svg', 'bbb.png', 'ccc.wav']);
    });
    test('ignores invalid JSON without throwing', () => {
        const referenced = new Set();
        expect(() => extractReferencedAssets('not-json', referenced)).not.toThrow();
        expect(referenced.size).toBe(0);
    });
});

describe('selectVersionsToThin', () => {
    test('keeps everything within the last 10 minutes', () => {
        const now = 1000 * HOUR;
        const timestamps = [now, now - MINUTE, now - (5 * MINUTE), now - (9 * MINUTE)];
        expect(selectVersionsToThin(timestamps, now)).toEqual([]);
    });
    test('keeps only the newest version per hour bucket between 10 minutes and 24 hours', () => {
        const now = (1000 * HOUR) + (30 * MINUTE);
        const keepNewest = (1000 * HOUR) + (10 * MINUTE); // 20 min old, hour bucket 1000
        const dropOlder = (1000 * HOUR) + (5 * MINUTE); // 25 min old, same bucket
        const keepPrevHour = (999 * HOUR) + (50 * MINUTE); // hour bucket 999
        const timestamps = [now, keepNewest, dropOlder, keepPrevHour];
        expect(selectVersionsToThin(timestamps, now)).toEqual([dropOlder]);
    });
    test('keeps only the newest version per day bucket between 24 hours and 30 days', () => {
        const now = 100 * DAY;
        const keep = (98 * DAY) + (10 * HOUR);
        const drop = (98 * DAY) + (5 * HOUR); // same day bucket as keep
        const keepOtherDay = (97 * DAY) + (10 * HOUR);
        const timestamps = [now, keep, drop, keepOtherDay];
        expect(selectVersionsToThin(timestamps, now)).toEqual([drop]);
    });
    test('enforces the hard cap of 40 versions per project', () => {
        const now = 1000 * HOUR;
        // 50 versions, all within the last 10 minutes (all in the keep-all band)
        const timestamps = Array.from({length: 50}, (_, i) => now - (i * 1000));
        const toDelete = selectVersionsToThin(timestamps, now);
        expect(toDelete).toHaveLength(10);
        // the oldest ones are dropped
        expect(toDelete).toEqual(timestamps.slice(40));
    });
});

describe('LocalProjectStorage.saveProject', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        db.getHeader.mockResolvedValue(null);
        db.getBody.mockResolvedValue(null);
        db.putHeader.mockResolvedValue('ok');
        db.putBody.mockResolvedValue('ok');
        db.putVersion.mockResolvedValue('ok');
        db.listVersions.mockResolvedValue([]);
        db.deleteVersions.mockResolvedValue(null);
    });

    const makeStorage = () => {
        const storage = new LocalProjectStorage();
        storage.noteProjectTitle('My Title');
        return storage;
    };

    test('creates a new record with header and body when projectId is null', async () => {
        const storage = makeStorage();
        const result = await storage.saveProject(null, '{"targets":[]}', {});
        expect(String(result.id)).toMatch(/^\d+$/);
        expect(db.putHeader).toHaveBeenCalledWith(expect.objectContaining({
            id: String(result.id),
            name: 'My Title'
        }));
        expect(db.putBody).toHaveBeenCalledWith({id: String(result.id), body: '{"targets":[]}'});
        expect(db.putVersion).toHaveBeenCalledWith(expect.objectContaining({projectId: String(result.id)}));
    });

    test('updates the existing record for a local numeric id, syncing the name to the current title', async () => {
        const existingHeader = {id: '1751400000000', name: 'Old', thumbnail: null, created: 1, modified: 1};
        db.getHeader.mockImplementation(id =>
            Promise.resolve(id === '1751400000000' ? {...existingHeader} : null));
        const storage = makeStorage();
        const result = await storage.saveProject('1751400000000', '{}', {});
        expect(result.id).toBe('1751400000000');
        // the name follows the current redux title (noted via noteProjectTitle)
        expect(db.putHeader).toHaveBeenCalledWith(expect.objectContaining({
            id: '1751400000000',
            name: 'My Title'
        }));
        expect(db.putBody).toHaveBeenCalledWith({id: '1751400000000', body: '{}'});
    });

    test('aliases "0" to one created record across repeated saves', async () => {
        const storage = makeStorage();
        const first = await storage.saveProject('0', '{}', {});
        // After creation, getHeader must find the created record for the update path
        db.getHeader.mockImplementation(id => Promise.resolve(
            id === String(first.id) ?
                {id: String(first.id), name: 'My Title', thumbnail: null, created: 1, modified: 1} :
                null
        ));
        const second = await storage.saveProject('0', '{}', {});
        expect(second.id).toBe(first.id);
        // only one header creation with a generated id
        expect(db.putBody).toHaveBeenCalledTimes(2);
        expect(db.putBody).toHaveBeenLastCalledWith({id: String(first.id), body: '{}'});
    });

    test('creates a new record for a copy even with a local id', async () => {
        const storage = makeStorage();
        const result = await storage.saveProject('1751400000000', '{}', {isCopy: 1, title: 'Copied'});
        expect(result.id).not.toBe('1751400000000');
        expect(db.putHeader).toHaveBeenCalledWith(expect.objectContaining({name: 'Copied'}));
    });

    test('saveProjectThumbnail patches the version written by the preceding save', async () => {
        const storage = makeStorage();
        const saved = await storage.saveProject(null, '{}', {title: 'P'});
        const id = String(saved.id);
        const versionArg = db.putVersion.mock.calls[0][0];
        db.getHeader.mockResolvedValue(
            {id, name: 'P', thumbnail: null, created: 1, modified: versionArg.timestamp});
        db.getVersion.mockResolvedValue({...versionArg});
        const thumbnail = {size: 123}; // stand-in for a Blob
        await storage.saveProjectThumbnail(id, thumbnail);
        expect(db.putVersion).toHaveBeenLastCalledWith(expect.objectContaining({
            projectId: id,
            timestamp: versionArg.timestamp,
            thumbnail
        }));
    });

    test('duplicateProject copies header, body and thumbnail under a new id', async () => {
        const thumbnail = {size: 42}; // stand-in for a Blob
        db.getHeader.mockImplementation(id => Promise.resolve(
            id === '1751400000000' ?
                {id: '1751400000000', name: 'Original', thumbnail, created: 1, modified: 2} :
                null
        ));
        db.getBody.mockImplementation(id => Promise.resolve(
            id === '1751400000000' ? {id: '1751400000000', body: '{"src":true}'} : null
        ));
        const storage = makeStorage();
        const result = await storage.duplicateProject('1751400000000', 'Original のコピー');
        expect(result.id).not.toBe('1751400000000');
        expect(db.putHeader).toHaveBeenCalledWith(expect.objectContaining({
            id: result.id,
            name: 'Original のコピー',
            thumbnail
        }));
        expect(db.putBody).toHaveBeenCalledWith({id: result.id, body: '{"src":true}'});
        expect(db.putVersion).toHaveBeenCalledWith(expect.objectContaining({
            projectId: result.id,
            body: '{"src":true}',
            thumbnail
        }));
    });

    test('setProjectComment updates the comment without touching modified', async () => {
        const header = {id: '1751400000000', name: 'P', thumbnail: null, created: 1, modified: 777, comment: ''};
        db.getHeader.mockImplementation(id => Promise.resolve(id === '1751400000000' ? {...header} : null));
        const storage = makeStorage();
        await storage.setProjectComment('1751400000000', 'メモです');
        expect(db.putHeader).toHaveBeenCalledWith(expect.objectContaining({
            id: '1751400000000',
            comment: 'メモです',
            modified: 777
        }));
        // unchanged comment writes nothing
        db.putHeader.mockClear();
        db.getHeader.mockImplementation(() => Promise.resolve({...header, comment: 'メモです'}));
        await storage.setProjectComment('1751400000000', 'メモです');
        expect(db.putHeader).not.toHaveBeenCalled();
    });

    test('skips the version snapshot when the body is unchanged', async () => {
        const header = {id: '1751400000000', name: 'P', thumbnail: null, created: 1, modified: 1};
        db.getHeader.mockImplementation(id => Promise.resolve(id === '1751400000000' ? {...header} : null));
        db.getBody.mockResolvedValue({id: '1751400000000', body: '{"same":true}'});
        const storage = makeStorage();
        await storage.saveProject('1751400000000', '{"same":true}', {});
        expect(db.putBody).toHaveBeenCalled();
        expect(db.putVersion).not.toHaveBeenCalled();
    });
});

describe('LocalProjectStorage.saveVersionWithMeta', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        db.getHeader.mockResolvedValue(null);
        db.getBody.mockResolvedValue(null);
        db.putHeader.mockResolvedValue('ok');
        db.putBody.mockResolvedValue('ok');
        db.putVersion.mockResolvedValue('ok');
        db.listVersions.mockResolvedValue([]);
        db.deleteVersions.mockResolvedValue(null);
        // thinning may trigger the orphan-asset GC
        db.getAllBodies.mockResolvedValue([]);
        db.getAllVersionBodies.mockResolvedValue([]);
        db.listAssetKeys.mockResolvedValue([]);
        db.deleteAssets.mockResolvedValue(null);
    });

    const makeStorage = () => {
        const storage = new LocalProjectStorage();
        storage.noteProjectTitle('My Title');
        return storage;
    };

    test('creates a new version even when the body is unchanged, unlike saveProject', async () => {
        const header = {id: '1751400000000', name: 'P', thumbnail: null, created: 1, modified: 1};
        db.getHeader.mockImplementation(id => Promise.resolve(id === '1751400000000' ? {...header} : null));
        db.getBody.mockResolvedValue({id: '1751400000000', body: '{"same":true}'});
        const storage = makeStorage();
        // saveProject skips the version snapshot for an identical body...
        await storage.saveProject('1751400000000', '{"same":true}', {});
        expect(db.putVersion).not.toHaveBeenCalled();
        // ...but saveVersionWithMeta force-writes one anyway
        const result = await storage.saveVersionWithMeta(
            '1751400000000', '{"same":true}', {comment: 'checkpoint', isKeep: false});
        expect(db.putVersion).toHaveBeenCalledTimes(1);
        expect(db.putVersion).toHaveBeenCalledWith(expect.objectContaining({
            projectId: '1751400000000',
            body: '{"same":true}',
            comment: 'checkpoint',
            isKeep: false
        }));
        expect(result.id).toBe('1751400000000');
        expect(result.timestamp).toBe(db.putVersion.mock.calls[0][0].timestamp);
    });

    test('sets comment, isKeep and diff, chaining parentTimestamp to the previous version', async () => {
        const storage = makeStorage();
        const saved = await storage.saveProject(null, '{"targets":[]}', {});
        const id = String(saved.id);
        const firstVersion = db.putVersion.mock.calls[0][0];
        db.getHeader.mockImplementation(headerId => Promise.resolve(
            headerId === id ?
                {id, name: 'My Title', thumbnail: null, created: 1, modified: firstVersion.timestamp} :
                null
        ));
        db.getBody.mockResolvedValue({id, body: '{"targets":[]}'});

        const result = await storage.saveVersionWithMeta(
            id, '{"targets":[],"x":1}', {comment: 'レベル1クリア', isKeep: true});

        expect(db.putVersion).toHaveBeenCalledTimes(2);
        const metaVersion = db.putVersion.mock.calls[1][0];
        expect(metaVersion).toEqual(expect.objectContaining({
            projectId: id,
            body: '{"targets":[],"x":1}',
            comment: 'レベル1クリア',
            isKeep: true,
            // chains to the version written by the preceding save
            parentTimestamp: firstVersion.timestamp
        }));
        // the diff is computed at creation time (real computeVersionDiff)
        expect(metaVersion.diff).toEqual(expect.objectContaining({code: expect.any(Boolean)}));
        expect(result).toEqual({id, timestamp: metaVersion.timestamp});
    });

    test('falls back to listVersions for parentTimestamp when the storage is fresh', async () => {
        const header = {id: '1751400000000', name: 'P', thumbnail: null, created: 1, modified: 1};
        db.getHeader.mockImplementation(id => Promise.resolve(id === '1751400000000' ? {...header} : null));
        db.listVersions.mockResolvedValue([
            {projectId: '1751400000000', timestamp: 5000, parentTimestamp: null, body: '{}', thumbnail: null}
        ]);
        const storage = makeStorage();
        await storage.saveVersionWithMeta('1751400000000', '{}', {});
        expect(db.putVersion).toHaveBeenCalledWith(expect.objectContaining({
            parentTimestamp: 5000,
            comment: '',
            isKeep: false
        }));
    });

    test('rejects for an id that is neither a local project id nor an alias', async () => {
        const storage = makeStorage();
        await expect(storage.saveVersionWithMeta('https://example.com/p.sb3', '{}', {}))
            .rejects.toThrow('Local project not found');
        expect(db.putVersion).not.toHaveBeenCalled();
    });

    test('rejects when no header exists for the project id', async () => {
        db.getHeader.mockResolvedValue(null);
        const storage = makeStorage();
        await expect(storage.saveVersionWithMeta('1751400000000', '{}', {}))
            .rejects.toThrow('Local project not found');
        expect(db.putVersion).not.toHaveBeenCalled();
    });

    test('versions marked isKeep=true survive thinning', async () => {
        const id = '1751400000000';
        db.getHeader.mockImplementation(headerId => Promise.resolve(
            headerId === id ? {id, name: 'P', thumbnail: null, created: 1, modified: 1} : null));
        const now = Date.now();
        // 45 versions, newest first, all within the keep-all band (last 10
        // minutes) - the hard cap of 40 marks the oldest 5 for deletion
        // (same fixture idea as the selectVersionsToThin hard-cap test).
        const versions = Array.from({length: 45}, (_, i) => ({
            projectId: id,
            timestamp: now - (i * 1000),
            parentTimestamp: null,
            body: '{}',
            thumbnail: null,
            isKeep: i >= 43 // ...but the two oldest are marked as kept
        }));
        db.listVersions.mockResolvedValue(versions);
        const storage = makeStorage();
        await storage.saveVersionWithMeta(id, '{"v":46}', {comment: 'kept', isKeep: true});

        expect(db.deleteVersions).toHaveBeenCalledTimes(1);
        const deletedTimestamps = db.deleteVersions.mock.calls[0][0].map(([, ts]) => ts);
        // un-kept thinning candidates are still deleted
        expect(deletedTimestamps).toEqual([
            versions[40].timestamp, versions[41].timestamp, versions[42].timestamp
        ]);
        // the isKeep versions among the candidates are spared
        expect(deletedTimestamps).not.toContain(versions[43].timestamp);
        expect(deletedTimestamps).not.toContain(versions[44].timestamp);
    });

    test('versions with a comment survive thinning', async () => {
        const id = '1751400000000';
        db.getHeader.mockImplementation(headerId => Promise.resolve(
            headerId === id ? {id, name: 'P', thumbnail: null, created: 1, modified: 1} : null));
        const now = Date.now();
        // same fixture as the isKeep test, but the two oldest carry a comment
        const versions = Array.from({length: 45}, (_, i) => ({
            projectId: id,
            timestamp: now - (i * 1000),
            parentTimestamp: null,
            body: '{}',
            thumbnail: null,
            comment: i >= 43 ? 'milestone' : ''
        }));
        db.listVersions.mockResolvedValue(versions);
        const storage = makeStorage();
        await storage.saveVersionWithMeta(id, '{"v":46}', {});

        expect(db.deleteVersions).toHaveBeenCalledTimes(1);
        const deletedTimestamps = db.deleteVersions.mock.calls[0][0].map(([, ts]) => ts);
        // uncommented thinning candidates are still deleted
        expect(deletedTimestamps).toEqual([
            versions[40].timestamp, versions[41].timestamp, versions[42].timestamp
        ]);
        // the commented versions among the candidates are spared
        expect(deletedTimestamps).not.toContain(versions[43].timestamp);
        expect(deletedTimestamps).not.toContain(versions[44].timestamp);
    });

    test('serializes concurrent saveProject and saveVersionWithMeta on the same project', async () => {
        const id = '1751400000000';
        db.getHeader.mockImplementation(headerId => Promise.resolve(
            headerId === id ? {id, name: 'P', thumbnail: null, created: 1, modified: 1} : null));
        const order = [];
        let releaseGate;
        const gate = new Promise(resolve => {
            releaseGate = resolve;
        });
        let firstGetBody = true;
        db.getBody.mockImplementation(async () => {
            if (firstGetBody) {
                firstGetBody = false;
                order.push('saveProject:getBody:start');
                await gate; // hold the first write mid-flight
                order.push('saveProject:getBody:end');
                return null;
            }
            order.push('saveVersionWithMeta:getBody');
            return null;
        });
        db.putVersion.mockImplementation(version => {
            order.push(`putVersion:${typeof version.comment === 'undefined' ? 'autosave' : 'meta'}`);
            return Promise.resolve('ok');
        });

        const storage = makeStorage();
        const autosave = storage.saveProject(id, '{"a":1}', {});
        const forced = storage.saveVersionWithMeta(id, '{"a":2}', {comment: 'checkpoint'});
        // let both calls start, then unblock the autosave
        await new Promise(resolve => setTimeout(resolve, 0));
        releaseGate();
        await Promise.all([autosave, forced]);

        // the forced save never starts its read-modify-write until the
        // autosave (started first) has completely finished
        expect(order).toEqual([
            'saveProject:getBody:start',
            'saveProject:getBody:end',
            'putVersion:autosave',
            'saveVersionWithMeta:getBody',
            'putVersion:meta'
        ]);
        // and the forced version chains to the autosaved one
        const autosaveVersion = db.putVersion.mock.calls[0][0];
        const metaVersion = db.putVersion.mock.calls[1][0];
        expect(metaVersion.parentTimestamp).toBe(autosaveVersion.timestamp);
    });
});

describe('LocalProjectStorage multi-tab conflict detection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        db.getHeader.mockResolvedValue(null);
        db.getBody.mockResolvedValue(null);
        db.putHeader.mockResolvedValue('ok');
        db.putBody.mockResolvedValue('ok');
        db.putVersion.mockResolvedValue('ok');
        db.listVersions.mockResolvedValue([]);
        db.deleteVersions.mockResolvedValue(null);
    });

    test('no conflict for an unknown (never loaded/saved) project', async () => {
        const storage = new LocalProjectStorage();
        db.getHeader.mockResolvedValue({id: '42', name: 'P', thumbnail: null, created: 1, modified: 999});
        expect(await storage.hasConflict('42')).toBe(false);
    });

    test('detects a conflict when another tab bumped header.modified after our save', async () => {
        const storage = new LocalProjectStorage();
        const saved = await storage.saveProject(null, '{}', {title: 'P'});
        const id = String(saved.id);
        const savedModified = db.putHeader.mock.calls[0][0].modified;

        // stored header still matches what we wrote -> no conflict
        db.getHeader.mockResolvedValue({id, name: 'P', thumbnail: null, created: 1, modified: savedModified});
        expect(await storage.hasConflict(id)).toBe(false);

        // another tab wrote a newer revision -> conflict
        db.getHeader.mockResolvedValue({id, name: 'P', thumbnail: null, created: 1, modified: savedModified + 5000});
        expect(await storage.hasConflict(id)).toBe(true);
    });

    test('readProject clears the conflict by adopting the stored revision', async () => {
        const storage = new LocalProjectStorage();
        const saved = await storage.saveProject(null, '{}', {title: 'P'});
        const id = String(saved.id);
        const savedModified = db.putHeader.mock.calls[0][0].modified;
        db.getHeader.mockResolvedValue(
            {id, name: 'Newer', thumbnail: null, created: 1, modified: savedModified + 5000});
        db.getBody.mockResolvedValue({id, body: '{"latest":true}'});
        expect(await storage.hasConflict(id)).toBe(true);

        const project = await storage.readProject(id);
        expect(project).toEqual({body: '{"latest":true}', name: 'Newer'});
        expect(await storage.hasConflict(id)).toBe(false);
    });

    test('overwriting via saveProject clears the conflict', async () => {
        const storage = new LocalProjectStorage();
        const saved = await storage.saveProject(null, '{}', {title: 'P'});
        const id = String(saved.id);
        const savedModified = db.putHeader.mock.calls[0][0].modified;
        db.getHeader.mockResolvedValue({id, name: 'P', thumbnail: null, created: 1, modified: savedModified + 5000});
        expect(await storage.hasConflict(id)).toBe(true);

        await storage.saveProject(id, '{"mine":true}', {});
        const lastWritten = db.putHeader.mock.calls[db.putHeader.mock.calls.length - 1][0].modified;
        db.getHeader.mockResolvedValue({id, name: 'P', thumbnail: null, created: 1, modified: lastWritten});
        expect(await storage.hasConflict(id)).toBe(false);
    });
});
