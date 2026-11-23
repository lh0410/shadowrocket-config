const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const signin = fs.readFileSync(path.join(__dirname, '../scripts/ninebot-signin.js'), 'utf8');
const ACCOUNT = 'ninebot_account_v1', STATE = 'ninebot_signin_state_v1', LOCK = 'ninebot_signin_lock_v1';
const auth = 'Bearer fake-ninebot-authorization', deviceId = 'fake-device-id';
const initial = () => ({ [ACCOUNT]: JSON.stringify({ authorization: auth, deviceId, revision: 'v1' }) });

function run(options = {}) {
  const store = options.store || initial();
  const calls = [], notices = [], logs = [];
  let done = 0, instant = Date.parse(options.time || '2026-11-15T03:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const math = Object.create(Math);
  math.random = () => options.random ?? 0;
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
    Date: Clock, Math: math, console: { log: value => logs.push(String(value)) },
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
  if (options.capture) context.$argument = 'capture';
  vm.runInNewContext(signin, context);
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
  const result = run({ request, store: {} });
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

test('manual capture without a request never falls through to sign-in', () => {
  const result = run({ capture: true });
  assert.equal(result.notices[0][1], '脚本已加载');
  assert.equal(result.calls.length, 0);
  assert(!result.store[STATE]);
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

test('outside 11 to 12 only queries and never submits', () => {
  for (const time of ['2026-11-15T02:59:59Z', '2026-11-15T04:00:00Z', '2026-11-15T15:00:00Z']) {
    const result = run({ time });
    assert.deepEqual(result.calls.map(c => c.endpoint), ['status']);
    assert.equal(JSON.parse(result.store[STATE]).status, 'pending');
  }
});

test('daily random minute remains fixed and executes once when due', () => {
  const first = run({ time: '2026-11-15T03:10:00Z', random: 0.9 });
  assert.equal(JSON.parse(first.store[STATE]).minute, 54);
  assert.equal(first.calls.length, 0);
  const waiting = run({ store: first.store, time: '2026-11-15T03:53:00Z', random: 0 });
  assert.equal(JSON.parse(waiting.store[STATE]).minute, 54);
  assert.equal(waiting.calls.length, 0);
  const due = run({ store: first.store, time: '2026-11-15T03:54:00Z', random: 0 });
  assert.equal(due.calls.length, 3);
  assert.equal(run({ store: due.store, time: '2026-11-15T03:55:00Z' }).calls.length, 0);
  const next = run({ store: due.store, time: '2026-11-16T03:00:00Z', random: 0.5 });
  assert.equal(JSON.parse(next.store[STATE]).minute, 30);
  assert.equal(next.calls.length, 0);
});

test('credential refresh preserves the same-day random plan', () => {
  const first = run({ random: 0.9 });
  run({ capture: true, request: req({ Authorization: 'Bearer refreshed-auth', device_id: deviceId }), store: first.store });
  const result = run({ store: first.store, random: 0 });
  assert.equal(JSON.parse(result.store[STATE]).minute, 54);
  assert.equal(result.calls.length, 0);
});

test('last random minute is available and crossing noon during precheck prevents submission', () => {
  const first = run({ random: 0.999 });
  assert.equal(JSON.parse(first.store[STATE]).minute, 59);
  assert.equal(first.calls.length, 0);
  assert.equal(run({ store: first.store, time: '2026-11-15T03:59:00Z' }).calls.length, 3);
  const crossing = run({ time: '2026-11-15T03:59:59Z', answer: () => ({ advanceTo: '2026-11-15T04:00:00Z' }) });
  assert.equal(crossing.calls.length, 1);
});

test('migrates old pending state while retaining completed and uncertain outcomes', () => {
  for (const status of ['pending', 'signed_in', 'uncertain']) {
    const store = { ...initial(), [STATE]: JSON.stringify({ day: '2026-11-15', revision: 'v1', deviceId, status }) };
    const result = run({ store });
    assert.equal(result.calls.length, status === 'pending' ? 3 : status === 'uncertain' ? 1 : 0);
  }
});

test('next Beijing date allows a new check-in', () => {
  const result = run();
  assert.equal(run({ store: result.store, time: '2026-11-16T03:00:00Z' }).calls.length, 3);
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
  const locked = { ...initial(), [LOCK]: JSON.stringify({ owner: 'other', expires: Date.parse('2026-11-15T03:01:00Z') }) };
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

test('the module enables only the two services and shares each script between its two triggers', () => {
  const module = fs.readFileSync(path.join(__dirname, '../modules/beiwaitan.sgmodule'), 'utf8');
  assert(module.includes('hostname = %APPEND% m.mallcoo.cn, cn-cbu-gateway.ninebot.com\n'));
  assert.deepEqual(module.match(/^(?:DOMAIN-SUFFIX|DOMAIN),.*$/gm), [
    'DOMAIN-SUFFIX,03061026.xyz,DIRECT',
    'DOMAIN,emby.barrybarry.top,DIRECT'
  ]);
  const scriptEntries = module.split('\n').filter(line => line.includes('script-path='));
  assert.equal(scriptEntries.length, 4);
  const [guestCapture, guestCron, nineCapture, nineCron] = scriptEntries;
  for (const [capture, cron, file, schedule] of [
    [guestCapture, guestCron, 'beiwaitan-signin.js', '*/5 11 * * *'],
    [nineCapture, nineCron, 'ninebot-signin.js', '* 11 * * *']
  ]) {
    assert(capture.includes('type=http-request,') && capture.includes(',argument=capture,'));
    assert(cron.includes('type=cron,cronexp="' + schedule + '"'));
    const source = capture.match(/script-path=([^,]+)/)[1];
    assert.equal(source, cron.match(/script-path=([^,]+)/)[1]);
    assert.equal(new URL(source).pathname.split('/').pop(), file);
  }
  const pattern = nineCapture.match(/pattern=(.*?),script-path=/)[1];
  assert(new RegExp(pattern).test(req().url));
  assert(new RegExp(pattern).test(req().url.replace('status?t=1', 'sign')));
  assert(!new RegExp(pattern).test(req().url.replace('/status', '/status-other')));
});
