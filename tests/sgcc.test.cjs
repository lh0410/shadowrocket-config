const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../scripts/sgcc-signin.js'), 'utf8');
const setup = fs.readFileSync(path.join(__dirname, '../scripts/sgcc-setup.js'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '../modules/beiwaitan.sgmodule'), 'utf8');
const STATE = 'sgcc_signin_state_v1', LOCK = 'sgcc_signin_lock_v1';
const phone = '13900009999', password = 'fake-password-keep-private', token = 'fake-session-keep-private';
const digest = value => crypto.createHash('md5').update(value).digest('hex');
function initial(session = true) {
  const store = { sgcc_phone: phone, sgcc_password: password };
  if (session) store.sgcc_session = JSON.stringify({ user: phone, token, userId: 'fake-user', province: '310000', exp: Date.parse('2026-12-01T00:00:00Z') });
  return store;
}
function state(store, patch = {}) { store[STATE] = JSON.stringify({ day: '2026-11-17', user: phone, status: 'pending', minute: 0, ...patch }); }
// 仅隔离昂贵的协议计算来验证调度与服务返回；下方另用真实实现验证算法和加密请求。
const protocolMock = `
const SG_BASE = 'https://csc-service.sgcc.com.cn:28630/', SERVER_PUB = 'public', CLIENT_PRIV = 'client';
const P_LOGIN = 'emss-uia-center-front/member/c2/f01', P_SMS = 'emss-uia-center-front/member/c1/f01';
const md5hex = value => _digest(value), randomBytes = n => new Uint8Array(n).fill(1), toHex = a => '01'.repeat(a.length);
const b64 = a => 'fake-seed', b64dec = a => new Uint8Array(32).fill(1);
class Profile { constructor() {} }
function deviceToken() { return { token: 'fake-device-private', time: '1', ts: Date.now() }; }
function appGuid() { return 'fake-guid-private'; } function appGuidNew() { return 'fake-guid-private'; }
function cnNow() { return { s14: '20261117110000' }; } function reqTimestamp() { return '20261117110000000'; }
function loginParams(user, pass, code, codeKey) { return { quInfo: { account: user, password: md5hex(pass), code: code || '', codeKey: codeKey || '' } }; }
function loginMd5() { return 'fake-sign'; }
function sm4EncryptHex(value) { return value; } function sm2EncryptKey() { return 'fake-key'; }
function sm3hex() { return 'fake-sign'; } function sm2DecryptKey() { return 'response-key'; }
function utf8dec(value) { return value; } function sm4DecryptHex(value) { return value; }
`;
const mocked = source.replace(/\/\/ PROTOCOL_START[^]*?\/\/ PROTOCOL_END/, protocolMock);

async function run(options = {}) {
  const store = options.store || initial(), calls = [], notices = [], logs = [];
  let instant = Date.parse(options.time || '2026-11-17T03:00:00Z'), done = 0, complete;
  const completion = new Promise(resolve => complete = resolve);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const math = Object.create(Math); math.random = () => options.random ?? 0;
  const context = {
    Date: Clock, Math: math, _digest: digest, console: { log: s => logs.push(String(s)) },
    $persistentStore: {
      read: key => store[key] ?? null,
      write: (value, key) => {
        if (options.failWrite === key || options.rejectWrite?.(value, key)) return false;
        if (value === null) delete store[key]; else store[key] = value;
        return true;
      }
    },
    $notification: { post: (...a) => notices.push(a) },
    $done: () => { done++; complete(); },
    $httpClient: { post: (request, callback) => {
      assert.equal(new URL(request.url).origin, 'https://csc-service.sgcc.com.cn:28630');
      assert.equal(request.timeout, 8); assert.equal(request.policy, 'DIRECT');
      const path = new URL(request.url).pathname, body = JSON.parse(JSON.parse(request.body).data);
      const action = path.includes('/c2/f01') ? 'login' : path.includes('/c1/f01') ? 'sms' : path.endsWith('0103514') ? 'sign' : 'gold';
      calls.push({ action, request, body });
      if (action === 'sign') {
        assert.equal(JSON.parse(store[STATE]).status, 'submitting');
        assert.equal(new Date(instant + 8 * 3600000).getUTCHours(), 11);
        assert.equal(body.activityCode, 'ACT20201212');
      }
      let data = action === 'login' ? { bizrt: { token, userInfo: [{ userId: 'fake-user', addressProvince: '310000' }], tokenExpireTime: 1296000 } } : action === 'sms' ? { bizrt: { codeKey: 'fake-sms-key-private' } } : action === 'sign' ? { rtnCode: '1', rtnData: 2 } : { rtnCode: '1', rtnData: 100 };
      const custom = options.answer?.({ action, calls, request, body, data }) || {};
      if (custom.advanceTo) instant = Date.parse(custom.advanceTo);
      const plain = custom.plain ?? { code: '1', data: custom.data ?? data };
      const outer = custom.outer ?? { respKey: 'fake-encrypted-key', encryptData: JSON.stringify(plain) };
      queueMicrotask(() => callback(custom.error || null, { status: custom.status || 200 }, custom.body ?? JSON.stringify(outer)));
    } }
  };
  vm.runInNewContext(options.script || mocked, context);
  await completion; assert.equal(done, 1);
  const visible = JSON.stringify({ notices, logs });
  for (const value of [phone, password, token, 'fake-device-private', 'fake-guid-private', 'fake-sms-key-private']) assert(!visible.includes(value));
  return { store, calls, notices, logs, visible };
}

test('SGCC signs once, uses direct official endpoint and displays actual reward and balance', async () => {
  const r = await run();
  assert.deepEqual(r.calls.map(c => c.action), ['sign', 'gold']);
  assert(r.visible.includes('2 签到金')); assert(r.visible.includes('余额 100'));
  assert.equal(JSON.parse(r.store[STATE]).status, 'signed_in');
  assert.equal((await run({ store: r.store })).calls.length, 0);
});
test('missing or malformed credentials never reach the network', async () => {
  for (const store of [{}, { sgcc_phone: 'invalid', sgcc_password: password }, { sgcc_phone: phone }]) {
    assert.equal((await run({ store })).calls.length, 0);
  }
});
test('fixed daily random minute, independent authentication and no early sign', async () => {
  const store = initial(false);
  const early = await run({ store, random: .5 });
  assert.deepEqual(early.calls.map(c => c.action), ['login']);
  assert.equal(JSON.parse(store[STATE]).minute, 30);
  assert.equal((await run({ store, time: '2026-11-17T03:29:00Z', random: .1 })).calls.length, 0);
  assert.deepEqual((await run({ store, time: '2026-11-17T03:30:00Z' })).calls.map(c => c.action), ['sign', 'gold']);
});
test('outside window can verify login and query balance but never submits', async () => {
  for (const time of ['2026-11-17T02:00:00Z', '2026-11-17T04:00:00Z']) {
    assert.deepEqual((await run({ store: initial(false), time })).calls.map(c => c.action), ['login', 'gold']);
  }
});
test('crossing noon during login prevents a subsequent sign', async () => {
  const r = await run({ store: initial(false), time: '2026-11-17T03:59:59Z', answer: ({ action }) => action === 'login' ? { advanceTo: '2026-11-17T04:00:00Z' } : {} });
  assert.deepEqual(r.calls.map(c => c.action), ['login', 'gold']);
});
test('first device verification sends one SMS and waits without repeated login or SMS', async () => {
  const store = initial(false);
  const r = await run({ store, answer: ({ action }) => action === 'login' ? { plain: { code: '4006', message: 'verify device' } } : {} });
  assert.deepEqual(r.calls.map(c => c.action), ['login', 'sms']);
  assert.equal(r.notices[0][1], '首次登录需短信验证');
  assert.equal((await run({ store, time: '2026-11-17T03:01:00Z' })).calls.length, 0);
});
test('new SMS code completes login even before planned minute and clears stored code', async () => {
  const store = initial(false); state(store, { minute: 50 }); store.sgcc_sms = '123456';
  store.sgcc_sms_pending = JSON.stringify({ user: phone, ts: Date.parse('2026-11-17T03:00:00Z'), codeKey: 'fake-sms-key-private', used: '' });
  const r = await run({ store, time: '2026-11-17T03:01:00Z' });
  assert.deepEqual(r.calls.map(c => c.action), ['login']);
  assert.equal(r.calls[0].body.quInfo.code, '123456');
  assert.equal(store.sgcc_sms, ''); assert.equal(store.sgcc_sms_pending, undefined);
  assert.equal(JSON.parse(store[STATE]).minute, 50);
});
test('used or expired SMS is not retried without explicit local reset', async () => {
  for (const ts of ['2026-11-17T02:59:00Z', '2026-11-17T02:00:00Z']) {
    const store = initial(false); store.sgcc_sms = '123456';
    store.sgcc_sms_pending = JSON.stringify({ user: phone, ts: Date.parse(ts), codeKey: 'fake-sms-key-private', used: '123456' });
    assert.equal((await run({ store })).calls.length, 0);
  }
});
test('SMS send timeout is recorded before dispatch so it is not automatically sent again', async () => {
  const store = initial(false);
  const r = await run({ store, answer: ({ action }) => action === 'login' ? { plain: { code: '4006' } } : action === 'sms' ? { error: 'uncertain send' } : {} });
  assert.deepEqual(r.calls.map(c => c.action), ['login', 'sms']);
  assert(JSON.parse(store.sgcc_sms_pending).sending);
  assert.equal((await run({ store })).calls.length, 0);
});
test('wrong password is blocked and corrected credentials can recover', async () => {
  const store = initial(false);
  await run({ store, answer: () => ({ plain: { code: '4001', message: '密码错误 ' + password } }) });
  assert.equal((await run({ store })).calls.length, 0);
  assert.equal((await run({ store, time: '2026-11-18T03:00:00Z' })).calls.length, 0);
  store.sgcc_password = password + '-corrected';
  assert.deepEqual((await run({ store, time: '2026-11-18T03:00:00Z' })).calls.map(c => c.action), ['login', 'sign', 'gold']);
});
test('sign timeout never triggers resubmission after session or credential refresh', async () => {
  const store = initial();
  await run({ store, answer: ({ action }) => action === 'sign' ? { error: 'timeout ' + token } : {} });
  assert.equal(JSON.parse(store[STATE]).status, 'uncertain');
  store.sgcc_reset_login = 'true';
  assert.equal((await run({ store })).calls.length, 0);
  assert.equal(JSON.parse(store[STATE]).status, 'uncertain');
});
test('definitive old-session rejection relogs once while ambiguous RK never replays sign', async () => {
  const retry = await run({ answer: ({ action, calls }) => action === 'sign' && calls.filter(c => c.action === 'sign').length === 1 ? { plain: { code: '-200' } } : {} });
  assert.deepEqual(retry.calls.map(c => c.action), ['sign', 'login', 'sign', 'gold']);
  const risk = await run({ answer: () => ({ outer: { code: 'ERR', message: 'RK001 ' + password } }) });
  assert.deepEqual(risk.calls.map(c => c.action), ['sign']);
  assert.equal(JSON.parse(risk.store[STATE]).status, 'uncertain');
});
test('explicit already signed code and zero rewards are kept accurate', async () => {
  const r = await run({ answer: ({ action }) => action === 'sign' ? { data: { rtnCode: '102007' } } : {} });
  assert(r.visible.includes('今日已签到')); assert(!r.visible.includes('本次获得'));
  const zero = await run({ answer: ({ action }) => action === 'sign' ? { data: { rtnCode: '1', rtnData: 0 } } : {} });
  assert(zero.visible.includes('获得 0 签到金'));
});
test('balance failure cannot turn confirmed sign into failure or trigger repetition', async () => {
  const r = await run({ answer: ({ action }) => action === 'gold' ? { error: 'fail' } : {} });
  assert.equal(JSON.parse(r.store[STATE]).status, 'signed_in');
  assert(r.visible.includes('签到成功')); assert(!r.visible.includes('余额'));
});
test('malformed JSON, HTTP errors and failed business results never claim success', async () => {
  for (const custom of [{ body: 'not json ' + password }, { status: 500 }, { data: { rtnCode: 'error', rtnMessage: password } }]) {
    const r = await run({ answer: () => custom });
    assert(!r.notices.some(n => n[1] === '签到成功'));
  }
});
test('active locks, corrupt state and failed writes prevent requests and preserve data', async () => {
  const locked = initial(); locked[LOCK] = JSON.stringify({ owner: 'another', expires: Date.parse('2026-11-17T03:05:00Z') });
  assert.equal((await run({ store: locked })).calls.length, 0);
  const corrupt = initial(); corrupt[STATE] = '{bad';
  assert.equal((await run({ store: corrupt })).calls.length, 0); assert.equal(corrupt[STATE], '{bad');
  assert.equal((await run({ failWrite: STATE })).calls.length, 0);
  const denied = await run({ rejectWrite: (value, key) => key === STATE && value?.includes('"submitting"') });
  assert.equal(denied.calls.length, 0);
});
test('Beijing day rollover makes a fresh plan, last random minute remains eligible', async () => {
  const store = initial(); state(store, { day: '2026-11-16', status: 'signed_in' });
  const r = await run({ store, time: '2026-11-17T03:59:00Z', random: .999 });
  assert.equal(JSON.parse(r.store[STATE]).minute, 59); assert.equal(r.calls[0].action, 'sign');
});
test('local setup saves credentials and SMS without network calls or clearing sign state', async () => {
  const store = initial(); state(store, { status: 'uncertain', minute: 34 });
  const r = await run({ store, script: setup.replace('var SGCC_SMS = "";', 'var SGCC_SMS = "123456";') });
  assert.equal(r.calls.length, 0); assert.equal(store.sgcc_sms, '123456');
  assert.equal(JSON.parse(store[STATE]).status, 'uncertain'); assert.equal(JSON.parse(store[STATE]).minute, 34);
  assert(!store.sgcc_reset_login);
});
test('empty local setup and invalid code never overwrite credentials', async () => {
  const store = initial(), old = store.sgcc_password;
  await run({ store, script: setup }); assert.equal(store.sgcc_password, old);
  await run({ store, script: setup.replace('var SGCC_SMS = "";', 'var SGCC_SMS = "bad";') });
  assert.equal(store.sgcc_sms, undefined);
});
test('retained protocol matches standard hash and block-cipher vectors', () => {
  const start = source.indexOf('/* ===== 国网 App 协议'), end = source.indexOf('// PROTOCOL_END');
  const protocol = source.slice(start, end), context = { crypto: crypto.webcrypto };
  vm.runInNewContext(protocol + '; globalThis.alg = {md5hex, sm3hex, sm4Key, sm4Block, fromHex, toHex, aes256EcbEncrypt, u8, sm2EncryptKey, sm2DecryptKey, ptMul, G, b32, concat, loginParams};', context);
  const a = context.alg;
  assert.equal(a.md5hex('中文🔑'), digest('中文🔑'));
  assert.equal(a.sm3hex('abc'), '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
  const key = a.fromHex('0123456789abcdeffedcba9876543210');
  assert.equal(a.toHex(a.sm4Block(a.sm4Key(key), key, true)), '681edf34d206965e86b3e94f536e4246');
  const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.alloc(32, 1), null);
  assert.equal(a.toHex(a.aes256EcbEncrypt(a.u8('中文abc'), new Uint8Array(32).fill(1))), Buffer.concat([cipher.update('中文abc'), cipher.final()]).toString('hex'));
  const privateKey = '1'.padStart(64, '0'), publicPoint = a.ptMul(1n, a.G), publicKey = '04' + a.toHex(a.concat(a.b32(publicPoint[0]), a.b32(publicPoint[1])));
  const encrypted = a.sm2EncryptKey('envelope-key', publicKey);
  assert.equal(Buffer.from(a.sm2DecryptKey(encrypted, privateKey)).toString(), 'envelope-key');
  assert.equal(a.loginParams(phone, password).quInfo.password, digest(password));
});
test('real runtime creates encrypted official request and rejects a malformed gateway response', async () => {
  const store = initial();
  let sent, ended;
  const completion = new Promise(resolve => ended = resolve);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-17T03:59:00Z'])); } static now() { return Date.parse('2026-11-17T03:59:00Z'); } }
  vm.runInNewContext(source, { Date: Clock, crypto: crypto.webcrypto, console: { log() {} }, $persistentStore: { read: k => store[k] ?? null, write: (v, k) => { if (v === null) delete store[k]; else store[k] = v; return true; } }, $notification: { post() {} }, $done: ended,
    $httpClient: { post: (r, cb) => { sent = r; cb(null, { status: 200 }, '{}'); } }
  });
  await completion;
  assert(sent); const payload = JSON.parse(sent.body);
  assert(/^[A-F0-9]+$/.test(payload.data)); assert(payload.skey.startsWith('04'));
  assert(!sent.body.includes(password)); assert(!sent.body.includes(phone));
  assert.equal(JSON.parse(store[STATE]).status, 'uncertain');
});
test('module cron, BoxJS and licenses use only local credential inputs', () => {
  assert(config.includes('网上国网每日签到 = type=cron,cronexp="* 11 * * *"'));
  assert(config.includes('DOMAIN,csc-service.sgcc.com.cn,DIRECT'));
  const box = JSON.parse(fs.readFileSync(path.join(__dirname, '../walter.boxjs.json'), 'utf8'));
  assert.deepEqual(box.apps[0].settings.slice(0, 3).map(x => x.val), ['', '', '']);
  assert(source.includes('Copyright (c) 2026 stevenjoezhang'));
  assert(!source.includes('console.log(response.body)'));
});
