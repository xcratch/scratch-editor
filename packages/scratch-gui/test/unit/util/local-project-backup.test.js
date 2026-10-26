import JSZip from 'jszip';

import {exportBackup, importBackup, BACKUP_FORMAT} from '../../../src/lib/local-project-backup';

import * as db from '../../../src/lib/local-project-db';

jest.mock('../../../src/lib/local-project-db', () => ({
    getHeader: jest.fn(),
    putHeader: jest.fn(),
    getBody: jest.fn(),
    putBody: jest.fn(),
    getAsset: jest.fn(),
    putAsset: jest.fn(),
    putVersion: jest.fn(),
    listVersions: jest.fn()
}));

const projectBody = costumeId => JSON.stringify({
    targets: [{
        costumes: [{assetId: costumeId, dataFormat: 'svg', md5ext: `${costumeId}.svg`}],
        sounds: [{assetId: 'snd', dataFormat: 'wav', md5ext: 'snd.wav'}]
    }]
});

// In-memory stand-in for the IndexedDB stores
const makeStore = () => {
    const store = {headers: {}, bodies: {}, assets: {}, versions: {}};
    db.getHeader.mockImplementation(id => Promise.resolve(store.headers[id]));
    db.putHeader.mockImplementation(h => {
        store.headers[h.id] = h;
        return Promise.resolve();
    });
    db.getBody.mockImplementation(id => Promise.resolve(store.bodies[id]));
    db.putBody.mockImplementation(b => {
        store.bodies[b.id] = b;
        return Promise.resolve();
    });
    db.getAsset.mockImplementation(key => Promise.resolve(store.assets[key]));
    db.putAsset.mockImplementation(a => {
        store.assets[a.md5ext] = a;
        return Promise.resolve();
    });
    db.listVersions.mockImplementation(id => Promise.resolve(Object.values(store.versions)
        .filter(v => v.projectId === id)
        .sort((a, b) => b.timestamp - a.timestamp)));
    db.putVersion.mockImplementation(v => {
        store.versions[`${v.projectId}@${v.timestamp}`] = v;
        return Promise.resolve();
    });
    return store;
};

const seed = store => {
    store.headers['100'] = {
        id: '100', name: 'Cat', comment: 'note', created: 1, modified: 30, thumbnail: null
    };
    store.bodies['100'] = {id: '100', body: projectBody('own')};
    store.versions['100@20'] = {
        projectId: '100', timestamp: 20, parentTimestamp: null, body: projectBody('old'),
        comment: 'first', isKeep: true, diff: {added: 1}
    };
    store.versions['100@30'] = {
        projectId: '100', timestamp: 30, parentTimestamp: 20, body: projectBody('own')
    };
    store.assets['own.svg'] = {
        md5ext: 'own.svg', assetId: 'own', dataFormat: 'svg', assetTypeName: 'ImageVector',
        data: new Uint8Array([1, 2, 3]), modified: 1
    };
    store.assets['old.svg'] = {
        md5ext: 'old.svg', assetId: 'old', dataFormat: 'svg', assetTypeName: 'ImageVector',
        data: new Uint8Array([4]), modified: 1
    };
};

const toBuffer = blob => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
});

describe('local project backup', () => {
    let store;
    beforeEach(() => {
        jest.clearAllMocks();
        store = makeStore();
        seed(store);
    });

    test('export includes history and loads assets missing from IndexedDB', async () => {
        const loadAsset = jest.fn((type, id, format) =>
            Promise.resolve(type === 'Sound' && id === 'snd' && format === 'wav' ? new Uint8Array([9]) : null));
        const {blob, projectCount, missingAssets} = await exportBackup(['100', '999'], loadAsset);
        expect(projectCount).toBe(1);
        expect(missingAssets).toBe(0);
        const zip = await JSZip.loadAsync(await toBuffer(blob));
        const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
        expect(manifest.format).toBe(BACKUP_FORMAT);
        expect(manifest.projects[0].versions.map(v => v.timestamp)).toEqual([30, 20]);
        expect(Object.keys(manifest.assets).sort()).toEqual(['old.svg', 'own.svg', 'snd.wav']);
        expect(zip.file('assets/snd.wav')).toBeTruthy();
    });

    test('export counts assets that cannot be loaded', async () => {
        const {missingAssets} = await exportBackup(['100'], () => Promise.reject(new Error('offline')));
        expect(missingAssets).toBe(1);
    });

    test('restores everything into an empty browser', async () => {
        const {blob} = await exportBackup(['100'], () => Promise.resolve(new Uint8Array([9])));
        const buffer = await toBuffer(blob);
        store = makeStore();

        const result = await importBackup(buffer, () => Promise.resolve('new'));
        expect(result).toEqual({imported: 1, skipped: 0});
        expect(store.headers['100']).toMatchObject({name: 'Cat', comment: 'note', created: 1, modified: 30});
        expect(store.bodies['100'].body).toBe(projectBody('own'));
        expect(store.versions['100@20']).toMatchObject({
            parentTimestamp: null, comment: 'first', isKeep: true, diff: {added: 1}, body: projectBody('old')
        });
        expect(store.versions['100@30'].parentTimestamp).toBe(20);
        expect(Array.from(store.assets['own.svg'].data)).toEqual([1, 2, 3]);
        expect(store.assets['snd.wav'].assetTypeName).toBe('Sound');
    });

    test('skips projects already stored unchanged', async () => {
        const {blob} = await exportBackup(['100'], () => Promise.resolve(new Uint8Array([9])));
        const result = await importBackup(await toBuffer(blob), () => Promise.resolve('new'));
        expect(result).toEqual({imported: 0, skipped: 1});
        expect(db.putHeader).not.toHaveBeenCalled();
    });

    test('gives a new id when a different project has the same id', async () => {
        const {blob} = await exportBackup(['100'], () => Promise.resolve(new Uint8Array([9])));
        store.headers['100'] = {...store.headers['100'], name: 'Changed', modified: 99};

        const result = await importBackup(await toBuffer(blob), () => Promise.resolve('200'));
        expect(result).toEqual({imported: 1, skipped: 0});
        expect(store.headers['100'].name).toBe('Changed');
        expect(store.headers['200']).toMatchObject({id: '200', name: 'Cat', modified: 30});
        expect(store.versions['200@20'].projectId).toBe('200');
    });

    test('rejects files that are not a backup', async () => {
        await expect(importBackup(new Uint8Array([1, 2, 3]), jest.fn())).rejects.toThrow('Not an Xcratch');
        const zip = new JSZip();
        zip.file('project.json', '{}');
        const sb3 = await zip.generateAsync({type: 'uint8array'});
        await expect(importBackup(sb3, jest.fn())).rejects.toThrow('Not an Xcratch');
    });
});
