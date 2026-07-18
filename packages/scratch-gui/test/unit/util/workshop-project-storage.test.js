import {WorkshopProjectStorage} from '../../../src/lib/workshop-project-storage';

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
