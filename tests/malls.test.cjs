const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');
const capture = fs.readFileSync(path.join(__dirname, '../scripts/mall-token.js'), 'utf8');
const signin = fs.readFileSync(path.join(__dirname, '../scripts/mall-signin.js'), 'utf8');
const moduleText = fs.readFileSync(path.join(__dirname, '../modules/beiwaitan.sgmodule'), 'utf8');
const ids = ['bailian', 'mixc', 'longhu'];
const key = (id, part = 'account') => `mall_${id}_${part}_v1`;
const secret = 'fake-personal-credential-keep-private';
const device = 'fake-device-keep-private';
const account = id => id === 'bailian' ? { membertoken: secret, devicekey: device, smDeviceid: 'fake-sm', revision: 'v1' } : id === 'mixc' ? {
  token: secret, mallNo: 'fake-mall', imei: device, deviceParams: 'fake-device-params', appVersion: '4.4.0', osVersion: '18.7', revision: 'v1'
} : { token: secret, activity: '1234567890', revision: 'v1', headers: {
  'X-LF-UserToken': secret, 'X-LF-DXRisk-Token': device, 'X-GAIA-API-KEY': 'fake-public-client-key', 'X-LF-Channel': 'C2'
} };
const initial = (selected = ids) => Object.fromEntries(selected.map(id => [key(id), JSON.stringify(account(id))]));
const state = (store, id, patch) => store[key(id, 'state')] = JSON.stringify({ day: '2026-11-17', minute: 0, status: 'pending', ...patch });
const digest = s => crypto.createHash('md5').update(s).digest('hex');

async function run(options = {}) {
  const store = options.store || initial(), calls = [], notices = [], logs = [];
  let instant = Date.parse(options.time || '2026-11-17T03:00:00Z'), done = 0, complete;
  const completion = new Promise(resolve => complete = resolve);
  const math = Object.create(Math); math.random = () => options.random ?? 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  function http(request, callback) {
    const url = new URL(request.url), data = request.headers['Content-Type'].includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(request.body)) : JSON.parse(request.body);
    const id = url.hostname === 'mh5.bl.com' ? 'bailian' : url.hostname === 'app.mixcapp.com' ? 'mixc' : 'longhu';
    const action = id === 'mixc' ? data.action.split('.').pop() : url.pathname.split('/').pop();
    calls.push({ id, action, request, data });
    const mutation = action === 'submitSignInv2.htm' || action === 'sign' || action === 'clock';
    if (mutation) {
      const local = JSON.parse(store[key(id, 'state')]);
      assert.equal(local.status, 'submitting');
      assert.equal(new Date(instant + 8 * 3600000).getUTCHours(), 11);
    }
    assert.equal(request.timeout, 8);
    let result;
    if (id === 'bailian') result = { resCode: '00100000', obj: JSON.stringify({ signStatus: '0', signPoint: '5', keepDays: 7 }) };
    if (id === 'mixc') {
      const copy = { ...data }; delete copy.sign;
      assert.equal(data.sign, digest(Object.keys(copy).sort().map(k => `${k}=${copy[k]}&`).join('') + 'P@Gkbu0shTNHjhM!7F'));
      assert.deepEqual(JSON.parse(Buffer.from(data.params, 'base64')), { mallNo: 'fake-mall' });
      result = action === 'sign' ? { code: 0, data: { signDataMap: { todayPoint: 3 }, userPoints: 999999 } } : { code: 0, data: { remaindPoints: 120, currentStep: 2 } };
    }
    if (id === 'longhu') {
      assert.equal(data.activity_no, '1234567890');
      assert.equal(request.headers['X-LF-DXRisk-Token'], device);
      const submitted = calls.some(c => c.id === id && c.action === 'clock');
      result = action === 'clock' ? { code: '0000', data: { is_popup: 1, reward_info: [{ reward_name: '成长值', reward_num: 5 }] } } : {
        code: '0000', data: { current_date_time: instant, seven_days_signs: [{ sign_year: 2026, sign_month: 11, sign_day: 17, sign_status: submitted ? 20 : 10 }] }
      };
    }
    const custom = options.answer?.({ id, action, request, data, calls, result }) || {};
    if (custom.advanceTo) instant = Date.parse(custom.advanceTo);
    if (custom.advanceMs) instant += custom.advanceMs;
    queueMicrotask(() => callback(custom.error || null, { status: custom.status || 200 }, custom.body ?? JSON.stringify(custom.result ?? result)));
  }
  const context = {
    Date: Clock, Math: math, console: { log: s => logs.push(String(s)) },
    $persistentStore: {
      read: k => store[k] ?? null,
      write: (value, k) => {
        if (options.failWrite === k || options.rejectWrite?.(value, k)) return false;
        if (value === null) delete store[k]; else store[k] = value;
        return true;
      }
    },
    $notification: { post: (...args) => notices.push(args) },
    $httpClient: { post: http },
    $done: () => { done++; complete(); }
  };
  if (options.request) context.$request = options.request;
  vm.runInNewContext(options.capture ? capture : signin, context);
  await completion;
  assert.equal(done, 1);
  const visible = JSON.stringify({ notices, logs });
  for (const credential of [secret, device, 'fake-sm', 'fake-device-params']) assert(!visible.includes(credential));
  return { store, calls, notices, logs, visible };
}
function request(id) {
  if (id === 'bailian') return { url: 'https://mh5.bl.com/h5_gateway/signIn/getTaskListv2.htm', headers: { MeMbErToKeN: secret, devicekey: device, 'SM-DEVICEID': 'fake-sm' } };
  if (id === 'mixc') return { url: 'https://app.mixcapp.com/mixc/api/v4/member/getPersonalData?' + new URLSearchParams({ ...account(id), platform: 'ios' }), headers: {} };
  return { url: 'https://gw2c-hw-open.longfor.com/lmarketing-task-api-mvc-prod/openapi/task/v1/signature/page-info', headers: account(id).headers, body: JSON.stringify({ activity_no: '1234567890' }) };
}

test('captures all three brands without modifying original requests or exposing credentials', async () => {
  for (const id of ids) {
    const req = request(id), before = JSON.stringify(req);
    const result = await run({ capture: true, store: {}, request: req });
    assert(JSON.parse(result.store[key(id)]).revision);
    assert.equal(JSON.stringify(req), before);
    assert.equal(result.calls.length, 0);
    assert.equal(result.notices[0][1], '签到参数已保存');
  }
});
test('captures gateway form parameters including encoded plus and equals correctly', async () => {
  const params = { ...account('mixc'), platform: 'h5', token: secret, deviceParams: 'abc+def==' };
  const r = await run({ capture: true, store: {}, request: { url: 'https://app.mixcapp.com/mixc/gateway', headers: {}, body: new URLSearchParams(params).toString() } });
  assert.equal(JSON.parse(r.store[key('mixc')]).deviceParams, 'abc+def==');
});
test('capture ignores unrelated, incomplete, malformed and unverified device requests', async () => {
  const bad = [
    { url: 'https://mh5.bl.com.evil.test/h5_gateway/x', headers: request('bailian').headers },
    { ...request('longhu'), body: '{' },
    { ...request('longhu'), headers: { 'X-LF-UserToken': secret } },
    { ...request('longhu'), body: JSON.stringify({ activity_no: 1234567890 }) },
    { url: 'https://app.mixcapp.com/mixc/gateway', headers: {}, body: 'token=incomplete' }
  ];
  for (const req of bad) {
    const r = await run({ capture: true, store: {}, request: req });
    assert(!ids.some(id => r.store[key(id)]));
  }
});
test('capture deduplicates and can renew an unchanged credential after explicit login or risk block', async () => {
  const r = await run({ capture: true, store: {}, request: request('longhu') });
  const old = r.store[key('longhu')], revision = JSON.parse(old).revision;
  assert.equal((await run({ capture: true, store: r.store, request: request('longhu') })).notices.length, 0);
  state(r.store, 'longhu', { blockedRevision: revision });
  await run({ capture: true, store: r.store, request: request('longhu'), time: '2026-11-17T03:01:00Z' });
  assert.notEqual(JSON.parse(r.store[key('longhu')]).revision, revision);
});
test('capture preserves invalid local credentials and never reports a failed write as saved', async () => {
  const store = { [key('bailian')]: '{bad' };
  await run({ capture: true, store, request: request('bailian') });
  assert.equal(store[key('bailian')], '{bad');
  const r = await run({ capture: true, store: {}, failWrite: key('bailian'), request: request('bailian') });
  assert(!r.notices.some(n => n[1] === '签到参数已保存'));
});
test('signs three brands independently and keeps real reward amounts and units', async () => {
  const r = await run();
  assert.deepEqual(r.calls.map(c => `${c.id}:${c.action}`), ['bailian:submitSignInv2.htm', 'mixc:sign', 'mixc:latticeList', 'longhu:page-info', 'longhu:clock', 'longhu:page-info']);
  assert(r.visible.includes('+5 积分'));
  assert(r.visible.includes('当前积分 120'));
  assert(!r.visible.includes('999999'));
  assert(r.visible.includes('成长值 +5'));
  for (const id of ids) assert.equal(JSON.parse(r.store[key(id, 'state')]).status, 'signed_in');
  assert.equal((await run({ store: r.store })).calls.length, 0);
});
test('random minute stays fixed across repeated checks and credential capture', async () => {
  const store = initial();
  const early = await run({ store, random: .5 });
  assert.equal(early.calls.length, 0);
  for (const id of ids) assert.equal(JSON.parse(store[key(id, 'state')]).minute, 30);
  await run({ capture: true, store, request: request('bailian') });
  assert.equal((await run({ store, random: 0, time: '2026-11-17T03:29:00Z' })).calls.length, 0);
  assert.equal((await run({ store, time: '2026-11-17T03:30:00Z' })).calls.length, 6);
});
test('three services keep separate random plans', async () => {
  const store = initial();
  for (const [i, id] of ids.entries()) state(store, id, { minute: i * 20 });
  const r = await run({ store, time: '2026-11-17T03:20:00Z' });
  assert.deepEqual([...new Set(r.calls.map(c => c.id))], ['bailian', 'mixc']);
});
test('outside the window only mixc status and longhu calendar are queried', async () => {
  for (const time of ['2026-11-17T02:59:00Z', '2026-11-17T04:00:00Z', '2026-11-17T15:59:00Z']) {
    const r = await run({ time });
    assert.deepEqual(r.calls.map(c => c.action), ['latticeList', 'page-info']);
  }
});
test('crossing noon during longhu precheck prevents submission', async () => {
  const r = await run({ store: initial(['longhu']), time: '2026-11-17T03:59:59Z', answer: () => ({ advanceTo: '2026-11-17T04:00:00Z' }) });
  assert.deepEqual(r.calls.map(c => c.action), ['page-info']);
});
test('unknown calendar status and server date mismatch prevent longhu submission', async () => {
  const variants = [
    { current_date_time: Date.parse('2026-11-16T03:00:00Z'), seven_days_signs: [] },
    { seven_days_signs: [{ sign_year: 2026, sign_month: 11, sign_day: 17, sign_status: 0 }] },
    { seven_days_signs: [] }, {}
  ];
  for (const data of variants) {
    const r = await run({ store: initial(['longhu']), answer: () => ({ result: { code: '0000', data } }) });
    assert.deepEqual(r.calls.map(c => c.action), ['page-info']);
  }
});
test('longhu requires confirmed calendar after submitting, including fake success responses', async () => {
  const r = await run({ store: initial(['longhu']), answer: ({ action, result }) => action === 'page-info' ? { result: { ...result, data: { seven_days_signs: [{ sign_year: 2026, sign_month: 11, sign_day: 17, sign_status: 10 }] } } } : {} });
  assert.equal(JSON.parse(r.store[key('longhu', 'state')]).status, 'uncertain');
  assert(!r.notices.some(n => n[1] === '签到成功'));
  assert.equal((await run({ store: r.store })).calls.filter(c => c.action === 'clock').length, 0);
});
test('already signed longhu calendar never posts clock', async () => {
  const r = await run({ store: initial(['longhu']), answer: ({ result }) => {
    result.data.seven_days_signs[0].sign_status = 20; return { result };
  } });
  assert.deepEqual(r.calls.map(c => c.action), ['page-info']);
});
test('timeouts on mutation never cause a second same-day mutation after credential refresh', async () => {
  for (const id of ids) {
    const store = initial([id]);
    const r = await run({ store, answer: ({ action }) => ['clock', 'sign', 'submitSignInv2.htm'].includes(action) ? { error: 'private secret error ' + secret } : {} });
    assert.equal(JSON.parse(store[key(id, 'state')]).status, 'uncertain');
    const updated = JSON.parse(store[key(id)]); updated.revision = 'v2'; store[key(id)] = JSON.stringify(updated);
    const next = await run({ store });
    assert(!next.calls.some(c => ['clock', 'sign', 'submitSignInv2.htm'].includes(c.action)));
    assert(!r.visible.includes('private secret error'));
  }
});
test('definitive login rejection blocks only that credential and resumes after refresh', async () => {
  const store = initial(['bailian']);
  await run({ store, answer: () => ({ status: 401 }) });
  assert.equal(JSON.parse(store[key('bailian', 'state')]).status, 'pending');
  assert.equal((await run({ store })).calls.length, 0);
  const updated = account('bailian'); updated.revision = 'v2'; store[key('bailian')] = JSON.stringify(updated);
  assert.equal((await run({ store })).calls.length, 1);
});
test('longhu risk blocks until capture, never fabricates device tokens or retries captcha', async () => {
  const store = initial(['longhu']);
  const r = await run({ store, answer: () => ({ result: { code: '8040012', message: 'need device ' + secret } }) });
  assert.equal(r.calls.length, 1);
  assert.equal((await run({ store })).calls.length, 0);
  assert(r.visible.includes('手动完成验证'));
  assert(r.calls.every(c => new URL(c.request.url).hostname === 'gw2c-hw-open.longfor.com'));
});
test('one provider failure never stops the other two', async () => {
  const r = await run({ answer: ({ id }) => id === 'bailian' ? { status: 500 } : {} });
  assert.equal(JSON.parse(r.store[key('mixc', 'state')]).status, 'signed_in');
  assert.equal(JSON.parse(r.store[key('longhu', 'state')]).status, 'signed_in');
});
test('mixc query failure after confirmed sign retains reward and sends successful result', async () => {
  const r = await run({ store: initial(['mixc']), answer: ({ action }) => action === 'latticeList' ? { error: 'fail' } : {} });
  assert.equal(JSON.parse(r.store[key('mixc', 'state')]).status, 'signed_in');
  assert(r.notices.some(n => n[1] === '签到成功' && n[2].includes('+3 积分')));
});
test('rate limits are not reported as signed and never expose response content', async () => {
  const r = await run({ store: initial(['mixc']), answer: () => ({ result: { code: -1, message: '请求频繁 ' + secret } }) });
  assert.equal(JSON.parse(r.store[key('mixc', 'state')]).status, 'uncertain');
  assert(!r.notices.some(n => n[1] === '签到成功' || n[1] === '今日已签到'));
});
test('bailian malformed reward does not invent success or points', async () => {
  const r = await run({ store: initial(['bailian']), answer: () => ({ result: { resCode: '00100000', obj: '{}' } }) });
  assert.equal(JSON.parse(r.store[key('bailian', 'state')]).status, 'uncertain');
  assert(!r.notices.some(n => n[1] === '签到成功'));
});
test('zero-point reward and explicit already signed responses are handled separately', async () => {
  const r = await run({ store: initial(['bailian']), answer: () => ({ result: { resCode: '00100000', obj: { signStatus: '0', signPoint: 0 } } }) });
  assert(r.visible.includes('+0 积分'));
  const m = await run({ store: initial(['mixc']), answer: () => ({ result: { code: -1, message: '今日已签到' } }) });
  assert.equal(JSON.parse(m.store[key('mixc', 'state')]).status, 'signed_in');
});
test('active locks, corrupt state and failed persistence prevent mutation', async () => {
  for (const id of ids) {
    const locked = initial([id]); locked[key(id, 'lock')] = JSON.stringify({ owner: 'other', expires: Date.parse('2026-11-17T03:02:00Z') });
    assert.equal((await run({ store: locked })).calls.length, 0);
    const corrupt = initial([id]); corrupt[key(id, 'state')] = '{bad';
    assert.equal((await run({ store: corrupt })).calls.length, 0);
    assert.equal(corrupt[key(id, 'state')], '{bad');
    const unwritable = initial([id]);
    assert.equal((await run({ store: unwritable, failWrite: key(id, 'state') })).calls.length, 0);
  }
});
test('a failure to save submitting state never sends a mutation', async () => {
  const r = await run({ store: initial(['bailian']), rejectWrite: (value, k) => k === key('bailian', 'state') && value?.includes('"submitting"') });
  assert.equal(r.calls.length, 0);
});
test('longhu signed requests renew timestamps and use MD5 matching Node standard library', async () => {
  const store = initial(['longhu']), a = account('longhu');
  a.signedHeaders = true; a.headers['X-Client-Type'] = 'microApp'; store[key('longhu')] = JSON.stringify(a);
  const r = await run({ store });
  for (const call of r.calls) {
    const h = call.request.headers;
    assert.equal(h['X-LONGZHU-Sign'], digest('activity_no=1234567890&' + h['X-LONGZHU-TimeStamp'] + '&Q74eKtH5LePYfSjIiflUbCL2gxjTa7rF'));
  }
});
test('independent MD5 implementation matches RFC vectors, Unicode and block boundaries', () => {
  const start = signin.indexOf('  function md5(value)'), end = signin.indexOf('  function form(data)', start);
  const compute = vm.runInNewContext('(' + signin.slice(start, end).trim() + ')');
  const vectors = ['', 'a', 'abc', 'message digest', '中文签到🔑', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(1000), 'a\r\nb'];
  for (const value of vectors) assert.equal(compute(value), digest(value));
});
test('a fresh Beijing day allows a new plan while a missed window does not backfill', async () => {
  const store = initial(['bailian']); state(store, 'bailian', { day: '2026-11-16', status: 'signed_in', minute: 59 });
  const r = await run({ store, random: .1 });
  assert.equal(r.calls.length, 0);
  assert.equal(JSON.parse(store[key('bailian', 'state')]).minute, 6);
  assert.equal((await run({ store, time: '2026-11-17T04:01:00Z' })).calls.length, 0);
});
test('missing account notifications are deduplicated and never make network calls', async () => {
  const r = await run({ store: {} });
  assert.equal(r.calls.length, 0); assert.equal(r.notices.length, 3);
  assert.equal((await run({ store: r.store })).notices.length, 0);
});
test('last random minute is eligible and malformed JSON after mutation remains uncertain', async () => {
  const last = await run({ store: initial(['bailian']), random: .9999, time: '2026-11-17T03:59:00Z' });
  assert.equal(last.calls.length, 1);
  assert.equal(JSON.parse(last.store[key('bailian', 'state')]).minute, 59);
  const bad = await run({ store: initial(['bailian']), answer: () => ({ body: 'private non-JSON ' + secret }) });
  assert.equal(JSON.parse(bad.store[key('bailian', 'state')]).status, 'uncertain');
});
test('run deadline defers remaining providers and safely reconciles a submitted longhu sign', async () => {
  const first = await run({ answer: ({ id }) => id === 'bailian' ? { advanceMs: 44000 } : {} });
  assert.deepEqual(first.calls.map(c => c.id), ['bailian']);
  const longhu = await run({ store: initial(['longhu']), answer: ({ action }) => action === 'clock' ? { advanceMs: 44000 } : {} });
  assert.equal(JSON.parse(longhu.store[key('longhu', 'state')]).status, 'uncertain');
  const check = await run({ store: longhu.store, answer: ({ result }) => {
    result.data.seven_days_signs[0].sign_status = 20; return { result };
  } });
  assert.deepEqual(check.calls.map(c => c.action), ['page-info']);
  assert.equal(JSON.parse(check.store[key('longhu', 'state')]).status, 'signed_in');
});
test('module registers actual capture domains and retains existing schedules and direct rules', () => {
  assert(moduleText.includes('DOMAIN-SUFFIX,03061026.xyz,DIRECT'));
  assert(moduleText.includes('DOMAIN,emby.barrybarry.top,DIRECT'));
  assert(moduleText.includes('cronexp="*/5 11 * * *"'));
  assert(moduleText.includes('ninebot-signin.js'));
  assert(moduleText.includes('百联万象龙湖签到 = type=cron,cronexp="* 11 * * *"'));
  for (const name of ['百联参数提取', '万象参数提取', '龙湖参数提取']) assert(moduleText.includes(name));
  for (const host of ['mh5.bl.com', 'app.mixcapp.com', 'gw2c-hw-open.longfor.com']) assert(moduleText.includes(host));
});
