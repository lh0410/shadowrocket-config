const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const capture = fs.readFileSync(path.join(__dirname, '../scripts/ninebot-token.js'), 'utf8');
const signin = fs.readFileSync(path.join(__dirname, '../scripts/ninebot-signin.js'), 'utf8');
const ACCOUNT = 'ninebot_account_v1', STATE = 'ninebot_signin_state_v1', LOCK = 'ninebot_signin_lock_v1';
const auth = 'Bearer fake-ninebot-authorization', deviceId = 'fake-device-id';
const initial = () => ({ [ACCOUNT]: JSON.stringify({ authorization: auth, deviceId, revision: 'v1' }) });

function run(options = {}) {
  const store = options.store || initial();
  const calls = [], notices = [], logs = [];
  let done = 0, instant = Date.parse(options.time || '2026-11-15T00:05:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  function http(method, request, callback) {
    const endpoint = new URL(request.url).pathname.split('/').pop();
    calls.push({ method, endpoint, request });
    const saved = JSON.parse(store[ACCOUNT]);
    assert.equal(request.headers.Authorization, saved.authorization);
    assert.equal(request.headers.device_id, saved.deviceId);
    if (method === 'post') {
      assert.equal(endpoint, 'sign');
      assert.deepEqual(JSON.parse(request.body), { deviceId: saved.deviceId });
      assert.equal(JSON.parse(store[STATE]).status, 'submitting');
    }
    const custom = options.answer?.(endpoint, calls.length) || {};
    if (custom.advanceTo) instant = Date.parse(custom.advanceTo);
    const data = custom.data || { code: 0, data: { currentSignStatus: calls.length >= 3 ? 1 : 0, consecutiveDays: 7 } };
    const reply = () => callback(custom.error || null, { status: custom.status || 200 }, custom.body ?? JSON.stringify(data));
    if (options.defer) queueMicrotask(reply); else reply();
  }
  const context = {
    Date: Clock, console: { log: value => logs.push(String(value)) },
    $persistentStore: {
      read: key => store[key] ?? null,
      write: (value, key) => {
        if (options.failWrite === key) return false;
        if (value === null) delete store[key]; else store[key] = value;
        return true;
      }
    },
    $notification: { post: (...args) => notices.push(args) },
    $done: value => { done++; assert(value === undefined || Object.keys(value).length === 0); },
    $httpClient: { get: (...args) => http('get', ...args), post: (...args) => http('post', ...args) }
  };
  if (options.request) context.$request = options.request;
  vm.runInNewContext(options.capture ? capture : signin, context);
  function verify() {
    assert.equal(done, 1);
    const visible = JSON.stringify({ notices, logs });
    assert(!visible.includes(auth)); assert(!visible.includes(deviceId));
    return { store, calls, notices, logs };
  }
  return options.defer ? new Promise(resolve => setImmediate(() => resolve(verify()))) : verify();
}

function req(headers = { Authorization: auth, device_id: deviceId }, body) {
  return { url: 'https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status?t=1', headers, body };
}

test('captures mixed case headers locally and passes through the request', () => {
  const request = req({ aUtHoRiZaTiOn: auth, DEVICE_ID: deviceId });
  const before = JSON.stringify(request);
  const result = run({ capture: true, request, store: {} });
  assert.equal(JSON.parse(result.store[ACCOUNT]).authorization, auth);
  assert.equal(JSON.parse(result.store[ACCOUNT]).deviceId, deviceId);
  assert.equal(result.notices[0][1], '签到参数已保存');
  assert.equal(JSON.stringify(request), before);
  assert.equal(result.calls.length, 0);
});

test('captures deviceId from the sign JSON body', () => {
  const request = req({ Authorization: auth }, JSON.stringify({ deviceId }));
  request.url = request.url.replace('status', 'sign');
  assert.equal(JSON.parse(run({ capture: true, request, store: {} }).store[ACCOUNT]).deviceId, deviceId);
});

test('capture deduplicates unchanged parameters and versions a refreshed token', () => {
  const store = initial();
  const result = run({ capture: true, request: req(), store });
  assert.equal(result.notices.length, 0);
  assert.equal(JSON.parse(store[ACCOUNT]).revision, 'v1');
  run({ capture: true, request: req({ Authorization: 'Bearer new-fake-auth', device_id: deviceId }), store });
  assert.notEqual(JSON.parse(store[ACCOUNT]).revision, 'v1');
});

test('does not mix partial requests or accept mismatched device IDs', () => {
  const store = {};
  run({ capture: true, request: req({ Authorization: auth }), store });
  run({ capture: true, request: req({ device_id: deviceId }), store });
  assert(!store[ACCOUNT]);
  run({ capture: true, request: req(undefined, JSON.stringify({ deviceId: 'different-device' })), store });
  assert(!store[ACCOUNT]);
});

test('ignores unrelated hosts and malformed bodies; header capture remains usable', () => {
  const request = req(); request.url = request.url.replace('ninebot.com', 'ninebot.com.attacker.example');
  assert(!run({ capture: true, request, store: {} }).store[ACCOUNT]);
  assert(run({ capture: true, request: req(undefined, '{broken'), store: {} }).store[ACCOUNT]);
  assert(!run({ capture: true, request: req({ Authorization: auth }, '{broken'), store: {} }).store[ACCOUNT]);
});

test('manual capture test does not claim credentials were captured', () => {
  const result = run({ capture: true, store: {} });
  assert.equal(result.notices[0][1], '脚本已加载');
  assert(!result.store[ACCOUNT]);
});

test('capture storage failure never reports saved credentials', () => {
  const result = run({ capture: true, request: req(), store: {}, failWrite: ACCOUNT });
  assert.equal(result.notices[0][1], '参数保存失败');
  assert(!result.store[ACCOUNT]);
});

test('checks, signs and verifies with asynchronous HTTP callbacks', async () => {
  const result = await run({ defer: true });
  assert.deepEqual(result.calls.map(c => c.endpoint), ['status', 'sign', 'status']);
  assert.equal(JSON.parse(result.store[STATE]).status, 'signed_in');
  assert.equal(result.notices[0][1], '签到成功');
  assert(result.notices[0][2].includes('7 天'));
  assert.equal(run({ store: result.store }).calls.length, 0);
});

test('server confirmed completion skips submission', () => {
  const result = run({ answer: () => ({ data: { code: 0, data: { currentSignStatus: 1 } } }) });
  assert.deepEqual(result.calls.map(c => c.endpoint), ['status']);
  assert.equal(JSON.parse(result.store[STATE]).status, 'signed_in');
});

test('missing credentials never issue HTTP requests and notification is deduplicated', () => {
  const result = run({ store: {} });
  assert.equal(result.calls.length, 0);
  assert.equal(result.notices[0][1], '尚未获取签到参数');
  assert.equal(run({ store: result.store }).notices.length, 0);
});

test('before 08:00 only queries and 23:05 can recover a missed morning run', () => {
  assert.deepEqual(run({ time: '2026-11-14T23:05:00Z' }).calls.map(c => c.endpoint), ['status']);
  assert.equal(JSON.parse(run({ time: '2026-11-15T15:05:00Z' }).store[STATE]).status, 'signed_in');
});

test('next Beijing date allows a new check-in', () => {
  const result = run();
  assert.equal(run({ store: result.store, time: '2026-11-16T00:05:00Z' }).calls.length, 3);
});

test('status request network failure remains retryable', () => {
  const first = run({ answer: () => ({ error: 'network down' }) });
  assert.equal(JSON.parse(first.store[STATE]).status, 'pending');
  assert.equal(run({ store: first.store }).calls.length, 3);
});

test('post timeout never resubmits; a later server status can reconcile it', () => {
  const first = run({ answer: endpoint => endpoint === 'sign' ? { error: 'timeout' } : null });
  assert.equal(JSON.parse(first.store[STATE]).status, 'uncertain');
  assert.deepEqual(run({ store: first.store }).calls.map(c => c.endpoint), ['status']);
  const last = run({ store: first.store, answer: () => ({ data: { code: 0, data: { currentSignStatus: 1 } } }) });
  assert.equal(JSON.parse(last.store[STATE]).status, 'signed_in');
});

test('success response without confirmed status remains uncertain', () => {
  const first = run({ answer: () => ({ data: { code: 0, data: { currentSignStatus: 0 } } }) });
  assert.equal(JSON.parse(first.store[STATE]).status, 'uncertain');
  assert(!first.notices.some(n => n[1] === '签到成功'));
  assert.equal(run({ store: first.store }).calls.length, 1);
});

test('verification network failure never causes a second submission', () => {
  const first = run({ answer: (endpoint, count) => count === 3 ? { error: 'timeout' } : null });
  assert.equal(JSON.parse(first.store[STATE]).status, 'uncertain');
  assert.equal(run({ store: first.store }).calls.length, 1);
});

test('HTTP 401 and business token expiry pause until new credentials are captured', () => {
  for (const response of [{ status: 401 }, { data: { code: 401 } }, { data: { code: 123, msg: 'token已过期' } }]) {
    const first = run({ answer: () => response });
    assert.equal(first.notices[0][1], '登录已过期');
    assert.equal(run({ store: first.store }).calls.length, 0);
    run({ capture: true, request: req({ Authorization: 'Bearer refreshed-auth', device_id: deviceId }), store: first.store });
    assert.equal(run({ store: first.store }).calls.length, 3);
  }
});

test('explicitly rejected unauthorized submission can recover with refreshed credentials', () => {
  const first = run({ answer: endpoint => endpoint === 'sign' ? { status: 401 } : null });
  assert.equal(JSON.parse(first.store[STATE]).status, 'pending');
  run({ capture: true, request: req({ Authorization: 'Bearer refreshed-auth', device_id: deviceId }), store: first.store });
  assert.equal(run({ store: first.store }).calls.length, 3);
});

test('refreshing credentials preserves an unresolved same-device submission', () => {
  const first = run({ answer: endpoint => endpoint === 'sign' ? { error: 'timeout' } : null });
  run({ capture: true, request: req({ Authorization: 'Bearer refreshed-auth', device_id: deviceId }), store: first.store });
  assert.equal(run({ store: first.store }).calls.length, 1);
});

test('changed account parameters recheck server even after completion', () => {
  const first = run();
  run({ capture: true, request: req({ Authorization: 'Bearer another-auth', device_id: 'another-device' }), store: first.store });
  assert.equal(run({ store: first.store }).calls.length, 3);
});

test('malformed state is retained; active lock and failed state saves prevent submission', () => {
  const store = { ...initial(), [STATE]: '{broken' };
  assert.equal(run({ store }).calls.length, 0);
  assert.equal(store[STATE], '{broken');
  const locked = { ...initial(), [LOCK]: JSON.stringify({ owner: 'other', expires: Date.parse('2026-11-15T00:06:00Z') }) };
  assert.equal(run({ store: locked }).calls.length, 0);
  assert(locked[LOCK]);
  assert.equal(run({ failWrite: STATE }).calls.length, 0);
  assert.equal(run({ failWrite: LOCK }).calls.length, 0);
});

test('unknown status, malformed JSON and business errors do not submit or expose server text', () => {
  for (const response of [
    { data: { code: 0, data: { currentSignStatus: false } } },
    { data: { code: 0 } }, { body: '<html>invalid</html>' },
    { data: { code: 123, msg: auth + deviceId } }, { status: 403 }, { status: 500 }
  ]) {
    const result = run({ answer: () => response });
    assert.equal(result.calls.length, 1);
    assert.equal(JSON.parse(result.store[STATE]).status, 'pending');
  }
});

test('midnight rollover during precheck never submits for the wrong date', () => {
  const result = run({ time: '2026-11-15T15:59:59Z', answer: () => ({ advanceTo: '2026-11-15T16:00:00Z' }) });
  assert.equal(result.calls.length, 1);
});

test('module keeps existing rules and BWT schedule while enabling both Ninebot scripts', () => {
  const module = fs.readFileSync(path.join(__dirname, '../modules/beiwaitan.sgmodule'), 'utf8');
  assert(module.includes('DOMAIN-SUFFIX,03061026.xyz,DIRECT'));
  assert(module.includes('DOMAIN,emby.barrybarry.top,DIRECT'));
  assert(module.includes('cronexp="*/5 11 * * *"'));
  assert(module.includes('cronexp="5 8-23 * * *"'));
  const pattern = module.split('\n').find(line => line.startsWith('九号参数提取')).match(/pattern=(.*?),script-path=/)[1];
  assert(new RegExp(pattern).test(req().url));
  assert(new RegExp(pattern).test(req().url.replace('status?t=1', 'sign')));
  assert(!new RegExp(pattern).test(req().url.replace('/status', '/status-other')));
});
