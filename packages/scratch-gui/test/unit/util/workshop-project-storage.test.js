import {WorkshopProjectStorage} from '../../../src/lib/workshop-project-storage';
import {LegacyStorage} from '../../../src/lib/legacy-storage';

const jsonResponse = body => ({
    ok: true,
    json: () => Promise.resolve(body)
});

describe('WorkshopProjectStorage.saveVersionWithMeta', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    const makeStorage = host => {
        const storage = new WorkshopProjectStorage();
        if (host) storage.setProjectHost(host);
        return storage;
    };

    test('POSTs to /{id}/versions with encoded comment and isKeep in the query', async () => {
        global.fetch.mockResolvedValue(jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 1000}));
        const storage = makeStorage('https://host');
        await storage.saveVersionWithMeta('42', '{"targets":[]}', {comment: 'コメント', isKeep: true});

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe(
            `https://host/42/versions?comment=${encodeURIComponent('コメント')}&isKeep=true`
        );
        expect(opts.method).toBe('POST');
    });

    test('omits comment from the query when not provided or empty', async () => {
        global.fetch.mockResolvedValue(jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 1000}));
        const storage = makeStorage('https://host');

        await storage.saveVersionWithMeta('42', '{}', {isKeep: false});
        expect(global.fetch.mock.calls[0][0]).toBe('https://host/42/versions?isKeep=false');

        await storage.saveVersionWithMeta('42', '{}', {comment: '', isKeep: false});
        expect(global.fetch.mock.calls[1][0]).toBe('https://host/42/versions?isKeep=false');
    });

    test('sends the raw vmState text as the request body', async () => {
        global.fetch.mockResolvedValue(jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 1000}));
        const storage = makeStorage('https://host');
        const vmState = '{"targets":[{"name":"Sprite1"}]}';
        await storage.saveVersionWithMeta('42', vmState, {});

        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.body).toBe(vmState);
        expect(opts.credentials).toBe('include');
    });

    test('appends the project token from setProjectToken alongside comment/isKeep', async () => {
        global.fetch.mockResolvedValue(jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 1000}));
        const storage = makeStorage('https://host');
        storage.setProjectToken('tok');
        await storage.saveVersionWithMeta('42', '{}', {comment: 'note', isKeep: true});

        expect(global.fetch.mock.calls[0][0]).toBe(
            'https://host/42/versions?comment=note&isKeep=true&token=tok'
        );
    });

    test('resolves with the id and versionTimestamp from the response', async () => {
        global.fetch.mockResolvedValue(jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 12345}));
        const storage = makeStorage('https://host');
        const result = await storage.saveVersionWithMeta('42', '{}', {});
        expect(result).toEqual({id: '42', timestamp: 12345});
    });

    test('a following saveProjectThumbnail PUTs to the new version returned by saveVersionWithMeta', async () => {
        global.fetch.mockResolvedValue(jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 12345}));
        const storage = makeStorage('https://host');
        await storage.saveVersionWithMeta('42', '{}', {});

        const thumbnail = {size: 1}; // stand-in for a Blob
        global.fetch.mockResolvedValue({ok: true});
        await storage.saveProjectThumbnail('42', thumbnail);

        const lastCall = global.fetch.mock.calls[global.fetch.mock.calls.length - 1];
        expect(lastCall[0]).toBe('https://host/42/versions/12345/thumbnail');
        expect(lastCall[1].method).toBe('PUT');
        expect(lastCall[1].body).toBe(thumbnail);
    });

    test('rejects when the server responds with a non-ok status', async () => {
        global.fetch.mockResolvedValue({ok: false, status: 500});
        const storage = makeStorage('https://host');
        await expect(storage.saveVersionWithMeta('42', '{}', {})).rejects.toThrow();
    });

    test('throws when the project host has not been set', async () => {
        const storage = makeStorage();
        await expect(storage.saveVersionWithMeta('42', '{}', {})).rejects.toThrow('Project host not set');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('WorkshopProjectStorage thumbnail upload', () => {
    const thumbnail = {size: 1}; // stand-in for a Blob

    const makeStorage = () => {
        const storage = new WorkshopProjectStorage();
        storage.setProjectHost('https://host');
        return storage;
    };

    // Registers a pending thumbnail the way a real save does: saveVersionWithMeta
    // records the version timestamp returned by the server.
    const saveVersion = async storage => {
        global.fetch = jest.fn().mockResolvedValue(
            jsonResponse({'content-name': 42, 'id': 42, 'versionTimestamp': 777})
        );
        await storage.saveVersionWithMeta('42', '{}', {});
    };

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('waitForPendingThumbnail resolves immediately when nothing is pending', async () => {
        const storage = makeStorage();
        await expect(storage.waitForPendingThumbnail()).resolves.toBeUndefined();
    });

    test('waits until the thumbnail PUT completes', async () => {
        const storage = makeStorage();
        await saveVersion(storage);

        let finishPut;
        global.fetch = jest.fn().mockReturnValue(new Promise(resolve => {
            finishPut = () => resolve({ok: true});
        }));
        const upload = storage.saveProjectThumbnail('42', thumbnail);
        let waited = false;
        const waiting = storage.waitForPendingThumbnail().then(() => {
            waited = true;
        });

        await Promise.resolve();
        expect(waited).toBe(false);
        finishPut();
        await upload;
        await waiting;
        expect(waited).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        // nothing left to wait for
        await expect(storage.waitForPendingThumbnail()).resolves.toBeUndefined();
    });

    test('also waits when the thumbnail PUT has not been issued yet', async () => {
        const storage = makeStorage();
        await saveVersion(storage);

        let waited = false;
        const waiting = storage.waitForPendingThumbnail().then(() => {
            waited = true;
        });
        await Promise.resolve();
        expect(waited).toBe(false);

        global.fetch = jest.fn().mockResolvedValue({ok: true});
        await storage.saveProjectThumbnail('42', thumbnail);
        await waiting;
        expect(waited).toBe(true);
    });

    test('retries once after a failed PUT and settles after the retry', async () => {
        const storage = makeStorage();
        await saveVersion(storage);

        global.fetch = jest.fn()
            .mockResolvedValueOnce({ok: false, status: 500})
            .mockResolvedValueOnce({ok: true});
        const upload = storage.saveProjectThumbnail('42', thumbnail);
        await jest.advanceTimersByTimeAsync(1000);
        await upload;

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[1][0]).toBe('https://host/42/versions/777/thumbnail');
        await expect(storage.waitForPendingThumbnail()).resolves.toBeUndefined();
    });

    test('retries once after a network error and gives up quietly after the second failure', async () => {
        const storage = makeStorage();
        await saveVersion(storage);

        global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const upload = storage.saveProjectThumbnail('42', thumbnail);
        await jest.advanceTimersByTimeAsync(1000);
        await expect(upload).resolves.toBeUndefined();

        expect(global.fetch).toHaveBeenCalledTimes(2);
        await expect(storage.waitForPendingThumbnail()).resolves.toBeUndefined();
    });

    test('waitForPendingThumbnail gives up after its own timeout', async () => {
        const storage = makeStorage();
        await saveVersion(storage);

        global.fetch = jest.fn().mockReturnValue(new Promise(() => {})); // never completes
        storage.saveProjectThumbnail('42', thumbnail);
        let waited = false;
        const waiting = storage.waitForPendingThumbnail(2000).then(() => {
            waited = true;
        });
        await jest.advanceTimersByTimeAsync(1999);
        expect(waited).toBe(false);
        await jest.advanceTimersByTimeAsync(2);
        await waiting;
        expect(waited).toBe(true);
    });

    test('stops waiting when saveProjectThumbnail is never called', async () => {
        const storage = makeStorage();
        await saveVersion(storage);

        let waited = false;
        const waiting = storage.waitForPendingThumbnail(60000).then(() => {
            waited = true;
        });
        await jest.advanceTimersByTimeAsync(4999);
        expect(waited).toBe(false);
        await jest.advanceTimersByTimeAsync(2);
        await waiting;
        expect(waited).toBe(true);
    });

    describe('saveProject', () => {
        const params = {originalId: '', isCopy: false, isRemix: false, title: 't'};
        let spy;
        afterEach(() => spy.mockRestore());

        test('with a versionTimestamp it registers a pending thumbnail', async () => {
            spy = jest.spyOn(LegacyStorage.prototype, 'saveProject')
                .mockResolvedValue({id: 42, versionTimestamp: 900});
            const storage = makeStorage();
            await storage.saveProject(42, '{}', params);

            let waited = false;
            const waiting = storage.waitForPendingThumbnail().then(() => {
                waited = true;
            });
            await Promise.resolve();
            expect(waited).toBe(false);

            global.fetch = jest.fn().mockResolvedValue({ok: true});
            await storage.saveProjectThumbnail('42', thumbnail);
            await waiting;
            expect(global.fetch.mock.calls[0][0]).toBe('https://host/42/versions/900/thumbnail');
        });

        test('without a versionTimestamp nothing is pending and no thumbnail is sent', async () => {
            spy = jest.spyOn(LegacyStorage.prototype, 'saveProject').mockResolvedValue({id: 42});
            const storage = makeStorage();
            await storage.saveProject(42, '{}', params);
            await expect(storage.waitForPendingThumbnail()).resolves.toBeUndefined();

            global.fetch = jest.fn();
            await storage.saveProjectThumbnail('42', thumbnail);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });
});
