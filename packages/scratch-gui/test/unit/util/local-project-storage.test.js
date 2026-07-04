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
