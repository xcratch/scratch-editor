const tap = require('tap');
const path = require('path');
const readFileToBuffer = require('../fixtures/readProjectFile').readFileToBuffer;
const VirtualMachine = require('../../src/virtual-machine');
const Runtime = require('../../src/engine/runtime');
const MonitorRecord = require('../../src/engine/monitor-record');
const {Map} = require('immutable');

const test = tap.test;

test('spec', t => {
    const r = new Runtime();

    t.type(Runtime, 'function');
    t.type(r, 'object');

    // Test types of cloud data managing functions
    t.type(r.hasCloudData, 'function');
    t.type(r.canAddCloudVariable, 'function');
    t.type(r.addCloudVariable, 'function');
    t.type(r.removeCloudVariable, 'function');

    t.ok(r instanceof Runtime);

    t.end();
});

test('monitorStateEquals', t => {
    const r = new Runtime();
    const id = 'xklj4#!';
    const prevMonitorState = MonitorRecord({
        id,
        opcode: 'turtle whereabouts',
        value: '25'
    });
    const newMonitorDelta = Map({
        id,
        value: String(25)
    });
    r.requestAddMonitor(prevMonitorState);
    r.requestUpdateMonitor(newMonitorDelta);

    t.equal(true, prevMonitorState === r._monitorState.get(id));
    t.equal(String(25), r._monitorState.get(id).get('value'));
    t.end();
});

test('monitorStateDoesNotEqual', t => {
    const r = new Runtime();
    const id = 'xklj4#!';
    const params = {seven: 7};
    const prevMonitorState = MonitorRecord({
        id,
        opcode: 'turtle whereabouts',
        value: '25'
    });

    // Value change
    let newMonitorDelta = Map({
        id,
        value: String(24)
    });
    r.requestAddMonitor(prevMonitorState);
    r.requestUpdateMonitor(newMonitorDelta);

    t.equal(false, prevMonitorState.equals(r._monitorState.get(id)));
    t.equal(String(24), r._monitorState.get(id).get('value'));

    // Prop change
    newMonitorDelta = Map({
        id: 'xklj4#!',
        params: params
    });
    r.requestUpdateMonitor(newMonitorDelta);

    t.equal(false, prevMonitorState.equals(r._monitorState.get(id)));
    t.equal(String(24), r._monitorState.get(id).value);
    t.equal(params, r._monitorState.get(id).params);

    t.end();
});

test('getLabelForOpcode', t => {
    const r = new Runtime();

    const fakeExtension = {
        id: 'fakeExtension',
        name: 'Fake Extension',
        blocks: [
            {
                info: {
                    opcode: 'foo',
                    json: {},
                    text: 'Foo',
                    xml: ''
                }
            },
            {
                info: {
                    opcode: 'foo_2',
                    json: {},
                    text: 'Foo 2',
                    xml: ''
                }
            }
        ]
    };

    r._blockInfo.push(fakeExtension);

    const result1 = r.getLabelForOpcode('fakeExtension_foo');
    t.type(result1.category, 'string');
    t.type(result1.label, 'string');
    t.equal(result1.label, 'Fake Extension: Foo');

    const result2 = r.getLabelForOpcode('fakeExtension_foo_2');
    t.type(result2.category, 'string');
    t.type(result2.label, 'string');
    t.equal(result2.label, 'Fake Extension: Foo 2');

    t.end();
});

test('Project loaded emits runtime event', t => {
    const vm = new VirtualMachine();
    const projectUri = path.resolve(__dirname, '../fixtures/default.sb2');
    const project = readFileToBuffer(projectUri);
    let projectLoaded = false;

    vm.runtime.addListener('PROJECT_LOADED', () => {
        projectLoaded = true;
    });

    vm.loadProject(project).then(() => {
        t.equal(projectLoaded, true, 'Project load event emitted');
        t.end();
    });
});

test('Cloud variable limit allows only 10 cloud variables', t => {
    // This is a test of just the cloud variable limit mechanism
    // The functions being tested below need to be used when
    // creating and deleting cloud variables in the runtime.

    const rt = new Runtime();

    t.equal(rt.hasCloudData(), false);

    for (let i = 0; i < 10; i++) {
        t.equal(rt.canAddCloudVariable(), true);
        rt.addCloudVariable();
        // Adding a cloud variable should change the
        // result of the hasCloudData check
        t.equal(rt.hasCloudData(), true);
    }


    // We should be at the cloud variable limit now
    t.equal(rt.canAddCloudVariable(), false);

    // Removing a cloud variable should allow the addition of exactly one more
    // when we are at the cloud variable limit
    rt.removeCloudVariable();

    t.equal(rt.canAddCloudVariable(), true);
    rt.addCloudVariable();
    t.equal(rt.canAddCloudVariable(), false);

    // Disposing of the runtime should reset the cloud variable limitations
    rt.dispose();
    t.equal(rt.hasCloudData(), false);

    for (let i = 0; i < 10; i++) {
        t.equal(rt.canAddCloudVariable(), true);
        rt.addCloudVariable();
        t.equal(rt.hasCloudData(), true);
    }

    // We should be at the cloud variable limit now
    t.equal(rt.canAddCloudVariable(), false);

    t.end();

});

test('Starting the runtime emits an event', t => {
    let started = false;
    const rt = new Runtime();
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });
    rt.start();
    t.equal(started, true);
    rt.quit();
    t.end();
});

test('Runtime cannot be started while already running', t => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it can be started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    // Starting again should not emit another event
    rt.start();
    t.equal(started, false);
    rt.quit();
    t.end();
});

test('setCompatibilityMode restarts if it was already running', t => {
    const rt = new Runtime();
    rt.start(); // Start the first time

    // Set up a flag/listener to check if it gets started again
    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setCompatibilityMode(true);
    t.equal(started, true);
    rt.quit();
    t.end();
});

test('setCompatibilityMode does not restart if it was not running', t => {
    const rt = new Runtime();

    let started = false;
    rt.addListener('RUNTIME_STARTED', () => {
        started = true;
    });

    rt.setCompatibilityMode(true);
    t.equal(started, false);
    t.end();
});

test('Disposing the runtime emits an event', t => {
    let disposed = false;
    const rt = new Runtime();
    rt.addListener('RUNTIME_DISPOSED', () => {
        disposed = true;
    });
    rt.dispose();
    t.equal(disposed, true);
    t.end();
});

test('saveProjectVersion rejects when no save handler is attached', t => {
    const rt = new Runtime();
    return rt.saveProjectVersion('a comment', true).then(
        () => t.fail('saveProjectVersion should reject when no handler is attached'),
        err => {
            t.type(err, Error);
            t.match(err.message, /not supported/);
            t.end();
        }
    );
});

test('saveProjectVersion calls the attached handler and passes its promise through', t => {
    const rt = new Runtime();
    const calls = [];
    const result = {timestamp: 12345};
    rt.attachProjectSaveHandler((comment, isKeep) => {
        calls.push([comment, isKeep]);
        return Promise.resolve(result);
    });
    return rt.saveProjectVersion('level 1 cleared', true).then(value => {
        t.equal(calls.length, 1, 'handler called exactly once');
        t.equal(calls[0][0], 'level 1 cleared', 'comment passed as string');
        t.equal(calls[0][1], true, 'isKeep passed as boolean');
        t.equal(value, result, 'handler resolution value is passed through');
        t.end();
    });
});

test('saveProjectVersion passes handler rejection through', t => {
    const rt = new Runtime();
    const boom = new Error('storage failed');
    rt.attachProjectSaveHandler(() => Promise.reject(boom));
    return rt.saveProjectVersion('c', false).then(
        () => t.fail('rejection from the handler should be passed through'),
        err => {
            t.equal(err, boom, 'handler rejection reason is passed through');
            t.end();
        }
    );
});

test('saveProjectVersion coerces missing comment/isKeep to \'\' and false', t => {
    const rt = new Runtime();
    const calls = [];
    rt.attachProjectSaveHandler((comment, isKeep) => {
        calls.push([comment, isKeep]);
        return Promise.resolve();
    });
    return rt.saveProjectVersion().then(() => {
        t.equal(calls[0][0], '', 'undefined comment coerced to empty string');
        t.equal(calls[0][1], false, 'undefined isKeep coerced to false');
        // non-string / non-boolean values are coerced too
        return rt.saveProjectVersion(123, 1);
    })
        .then(() => {
            t.equal(calls[1][0], '123', 'numeric comment coerced to string');
            t.equal(calls[1][1], true, 'truthy isKeep coerced to boolean');
            t.end();
        });
});

test('attachProjectSaveHandler(null) detaches the handler', t => {
    const rt = new Runtime();
    const handler = () => Promise.resolve('saved');
    rt.attachProjectSaveHandler(handler);
    return rt.saveProjectVersion('c', false).then(value => {
        t.equal(value, 'saved', 'handler works while attached');
        rt.attachProjectSaveHandler(null);
        return rt.saveProjectVersion('c', false).then(
            () => t.fail('saveProjectVersion should reject after the handler is detached'),
            err => {
                t.type(err, Error);
                t.end();
            }
        );
    });
});

test('vm.attachProjectSaveHandler forwards to the runtime', t => {
    const vm = new VirtualMachine();
    const calls = [];
    vm.attachProjectSaveHandler((comment, isKeep) => {
        calls.push([comment, isKeep]);
        return Promise.resolve('ok');
    });
    return vm.runtime.saveProjectVersion('via vm', false).then(value => {
        t.equal(calls.length, 1, 'handler attached through the vm is used by the runtime');
        t.equal(calls[0][0], 'via vm');
        t.equal(calls[0][1], false);
        t.equal(value, 'ok');
        t.end();
    });
});

test('Clock is reset on runtime dispose', t => {
    const rt = new Runtime();
    const c = rt.ioDevices.clock;
    let simulatedTime = 0;

    c._projectTimer = {
        timeElapsed: () => simulatedTime,
        start: () => {
            simulatedTime = 0;
        }
    };

    t.ok(c.projectTimer() === 0);
    simulatedTime += 1000;
    t.ok(c.projectTimer() === 1);
    rt.dispose();
    // When the runtime is disposed, the clock should be reset
    t.ok(c.projectTimer() === 0);
    t.end();
});
