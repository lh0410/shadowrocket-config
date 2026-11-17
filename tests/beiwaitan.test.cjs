const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../scripts/beiwaitan-signin.js', 'utf8');

const STATE = 'beiwaitan_signin_state_v1';
const CHECK = '/api/user/user/CheckinBefore';
const DETAIL = '/api/user/User/GetCheckinDetail';
const RULE = '/api/user/Checkin/GetCheckinRuleBasicInfo';
const SIGN = '/api/user/User/CheckinV2';
const RealDate = Date;

function run(options = {}) {
  const store = options.store || { beiwaitan_token: 'fake-phone-token' };
  const calls = [], notices = [], logs = [];
  let done = 0;
  let instant = RealDate.parse(options.time || '2026-11-11T03:30:00Z');
  class Clock extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const math = Object.create(Math);
  math.random = () => options.random || 0;
  const context = {
    Date: Clock, Math: math,
    console: { log: value => logs.push(value) },
    $persistentStore: {
      read: key => store[key] || null,
      write: (value, key) => {
        if (options.failWrite && options.failWrite(key, value)) return false;
        if (value === null) delete store[key]; else store[key] = value;
        return true;
      }
    },
    $notification: { post: (...args) => notices.push(args) },
    $done: () => { done++; },
    $httpClient: { post: (request, callback) => {
      const path = new URL(request.url).pathname;
      calls.push({ path, body: JSON.parse(request.body) });
      assert.equal(calls.at(-1).body.Header.Token, store.beiwaitan_token);
      assert.equal(request.timeout, 12);
      let result = { m: 1, d: path === CHECK ? { IsCheckIn: false, IsOpenCheckin: true } : path === DETAIL ? { ContinueDay: options.continueDay ?? 0 } : path === RULE ? { IsOpenCheckinForPosition: false } : { IsCheckIn: true, Content: '3' } };
      const custom = options.answer && options.answer(path, calls.length);
      if (custom && custom.advanceTo) instant = RealDate.parse(custom.advanceTo);
      if (custom && custom.error) { callback(custom.error, null, null); return; }
      if (custom && custom.data) result = custom.data;
      if (custom && custom.beforeReply) custom.beforeReply(store);
      if (path === SIGN) assert.equal(JSON.parse(store[STATE]).status, 'submitting');
      const reply = () => callback(null, { status: custom?.status || 200 }, JSON.stringify(result));
      if (options.defer) queueMicrotask(reply); else reply();
    } }
  };
  vm.runInNewContext(source, context);
  function verify() {
    assert.equal(done, 1);
    assert(!logs.join('\n').includes('fake-phone-token'));
    assert(!JSON.stringify(notices).includes('fake-phone-token'));
    return { store, calls, notices, logs };
  }
  return options.defer ? new Promise(resolve => setImmediate(() => resolve(verify()))) : verify();
}

test('random plan waits and stays fixed for the day', () => {
  const first = run({ random: 0.99 });
  assert.equal(JSON.parse(first.store[STATE]).minute, 55);
  assert.equal(first.calls.length, 0);
  const second = run({ store: first.store, random: 0 });
  assert.equal(JSON.parse(second.store[STATE]).minute, 55);
  assert.equal(second.calls.length, 0);
});

test('signs after precheck and rule check; same day never posts twice', () => {
  const first = run();
  assert.deepEqual(first.calls.map(r => r.path), [CHECK, DETAIL, RULE, SIGN]);
  assert.equal(JSON.parse(first.store[STATE]).status, 'signed_in');
  const second = run({ store: first.store });
  assert.equal(second.calls.length, 0);
});

test('shows original reward message and delivery description from captured API fields', () => {
  const result = run({ answer: path => path === SIGN ? { data: { m: 1, d: {
    IsCheckIn: true, Content: '3', RewardType: 1, IsGiveSucess: true,
    Msg: '签到成功，奖励3积分', Desc: '积分10分钟以内发放'
  } } } : null });
  const message = result.notices[0][2];
  assert.equal(message, '签到成功，奖励3积分\n积分10分钟以内发放');
  assert.equal(JSON.parse(result.store[STATE]).rewardMessage, message);
  assert.equal(JSON.parse(result.store[STATE]).rewardDay, '2026-11-11');
});

test('keeps textual gift names and descriptions instead of filtering nonnumeric Content', () => {
  const result = run({ answer: path => path === SIGN ? { data: { m: 1, d: {
    IsCheckIn: true, Content: '咖啡兑换券1张', Msg: '签到成功', Desc: '请到我的券包查看'
  } } } : null });
  assert.equal(result.notices[0][2], '签到成功\n本次奖励：咖啡兑换券1张\n请到我的券包查看');
});

test('numeric rewards retain zero and known point units without guessing other types', () => {
  for (const [Content, RewardType, expected] of [[3, 1, '3积分'], ['0', 1, '0积分'], ['2', 99, '2']]) {
    const result = run({ answer: path => path === SIGN ? { data: { m: 1, d: { IsCheckIn: true, Content, RewardType } } } : null });
    assert.equal(result.notices[0][2], '本次奖励：' + expected);
  }
});

test('missing or structured reward fields do not invent gift details', () => {
  const result = run({ answer: path => path === SIGN ? { data: { m: 1, d: {
    IsCheckIn: true, Content: { unexpected: 'field' }, Msg: null, Desc: ['invalid']
  } } } : null });
  assert.equal(result.notices[0][2], '接口已确认今日签到成功，未返回奖励明细。');
});

test('shows delivery uncertainty and normalizes markup without duplicating content', () => {
  const result = run({ answer: path => path === SIGN ? { data: { m: 1, d: {
    IsCheckIn: true, Content: '<b>咖啡券</b>', Msg: '签到成功，奖励咖啡券',
    Desc: '请到\n券包查看', IsGiveSucess: false
  } } } : null });
  assert.equal(result.notices[0][2], '签到成功，奖励咖啡券\n请到 券包查看\n奖励发放尚未确认，请在小程序核对。');
});

test('status check reuses only a confirmed reward saved on the same day', () => {
  const first = run();
  const statusAnswer = path => path === CHECK ? { data: { m: 2054, d: { IsCheckIn: true } } } : null;
  const sameDay = run({ store: first.store, time: '2026-11-11T06:00:00Z', continueDay: 1, answer: statusAnswer });
  assert(sameDay.notices[0][2].includes('本次奖励：3'));
  const nextDay = run({ store: first.store, time: '2026-11-12T06:00:00Z', continueDay: 1, answer: statusAnswer });
  assert(!nextDay.notices[0][2].includes('本次奖励：3'));
  assert(nextDay.notices[0][2].includes('本次状态查询未返回奖励明细'));
  assert.deepEqual(nextDay.calls.map(r => r.path), [CHECK, DETAIL]);
});

test('already checked in with m=2054 is accepted', () => {
  const result = run({ continueDay: 1, answer: path => path === CHECK ? { data: { m: 2054, d: { IsCheckIn: true } } } : null });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK, DETAIL]);
  assert.equal(JSON.parse(result.store[STATE]).status, 'already_signed_in');
});

test('manual run outside window only checks status', () => {
  const result = run({ time: '2026-11-11T06:00:00Z' });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK]);
  assert(result.notices[0][1].includes('状态检查通过'));
});

test('expired token is blocked until updated', () => {
  const first = run({ answer: () => ({ data: { m: 320, e: '用户token错误或已过期' } }) });
  assert.equal(first.notices[0][1], '登录已过期');
  const second = run({ store: first.store });
  assert.equal(second.calls.length, 0);
  assert.equal(second.notices.length, 0);
  first.store.beiwaitan_token = 'new-fake-token';
  const third = run({ store: first.store });
  assert.equal(JSON.parse(third.store[STATE]).status, 'signed_in');
});

test('network error before submitting remains retryable and is not login expiry', () => {
  const first = run({ answer: () => ({ error: 'network down' }) });
  assert.equal(JSON.parse(first.store[STATE]).status, 'pending');
  assert(!JSON.parse(first.store[STATE]).expiredToken);
  assert.equal(first.calls.length, 1);
});

test('timeout during submission prevents resubmitting; reconciliation can finish it', () => {
  const first = run({ answer: path => path === SIGN ? { error: 'timeout' } : null });
  assert.equal(JSON.parse(first.store[STATE]).status, 'uncertain');
  const second = run({ store: first.store });
  assert.deepEqual(second.calls.map(r => r.path), [CHECK]);
  const third = run({ store: first.store, continueDay: 1, answer: path => path === CHECK ? { data: { m: 2054, d: { IsCheckIn: true } } } : null });
  assert.equal(JSON.parse(third.store[STATE]).status, 'already_signed_in');
});

test('new location requirement blocks submitting', () => {
  const result = run({ answer: path => path === RULE ? { data: { m: 1, d: { IsOpenCheckinForPosition: true } } } : null });
  assert(!result.calls.some(r => r.path === SIGN));
});

test('crossing 12:00 during prechecks blocks submitting', () => {
  const result = run({ answer: path => path === RULE ? { advanceTo: '2026-11-11T04:00:00Z' } : null });
  assert(!result.calls.some(r => r.path === SIGN));
});

test('another active run is skipped', () => {
  const result = run({ store: { beiwaitan_token: 'fake-phone-token', beiwaitan_signin_lock_v1: JSON.stringify({ owner: 'another', expires: RealDate.parse('2026-11-11T03:31:00Z') }) } });
  assert.equal(result.calls.length, 0);
  assert(result.store.beiwaitan_signin_lock_v1);
});

test('missing token is reported without network calls', () => {
  const result = run({ store: {} });
  assert.equal(result.calls.length, 0);
  assert.equal(result.notices[0][1], '尚未获取 Token');
});

test('corrupt state is retained and prevents network requests', () => {
  const result = run({ store: { beiwaitan_token: 'fake-phone-token', [STATE]: '{broken' } });
  assert.equal(result.calls.length, 0);
  assert.equal(result.store[STATE], '{broken');
});

test('previous 08:00, 09:00 and 10:00 windows only query and never sign', () => {
  for (const hour of ['00', '01', '02']) {
    const result = run({ time: `2026-11-11T${hour}:30:00Z` });
    assert.deepEqual(result.calls.map(r => r.path), [CHECK]);
    assert(result.notices[0][2].includes('11–12'));
  }
});

test('seventh successful day schedules exactly one rest day and then resumes at day one', () => {
  const seventh = run({ continueDay: 6 });
  assert.equal(JSON.parse(seventh.store[STATE]).cycleCount, 7);
  assert.equal(JSON.parse(seventh.store[STATE]).restDay, '2026-11-12');
  assert(seventh.notices[0][2].includes('明天停签一天'));
  const rest = run({ store: seventh.store, time: '2026-11-12T03:00:00Z', random: 0.99 });
  assert.equal(rest.calls.length, 0);
  assert.equal(rest.notices[0][1], '今日停签一天');
  assert.equal(JSON.parse(rest.store[STATE]).status, 'rest');
  assert.equal(run({ store: seventh.store, time: '2026-11-12T03:55:00Z' }).calls.length, 0);
  assert.equal(run({ store: seventh.store, time: '2026-11-12T06:00:00Z' }).calls.length, 0);
  assert.equal(run({ store: seventh.store, time: '2026-11-12T03:55:00Z' }).notices.length, 0);
  const resumed = run({ store: seventh.store, time: '2026-11-13T03:30:00Z', continueDay: 7 });
  assert(resumed.calls.some(r => r.path === SIGN));
  assert.equal(JSON.parse(resumed.store[STATE]).cycleCount, 1);
  assert(!JSON.parse(resumed.store[STATE]).restDay);
});

test('initial server streak at or beyond seven rests today and never gets stuck on a stale count', () => {
  for (const continueDay of [7, 10, '7']) {
    const first = run({ continueDay });
    assert.deepEqual(first.calls.map(r => r.path), [CHECK, DETAIL]);
    assert.equal(JSON.parse(first.store[STATE]).restDay, '2026-11-11');
    const next = run({ store: first.store, time: '2026-11-12T03:30:00Z', continueDay });
    assert(next.calls.some(r => r.path === SIGN));
    assert.equal(JSON.parse(next.store[STATE]).cycleCount, 1);
  }
});

test('migrates a legacy already signed state using the server count without posting again', () => {
  const store = { beiwaitan_token: 'fake-phone-token', [STATE]: JSON.stringify({ day: '2026-11-11', status: 'signed_in', minute: 0 }) };
  const result = run({ store, continueDay: 7, answer: path => path === CHECK ? { data: { m: 2054, d: { IsCheckIn: true } } } : null });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK, DETAIL]);
  assert.equal(JSON.parse(store[STATE]).restDay, '2026-11-12');
  assert.equal(run({ store }).calls.length, 0);
  assert.equal(run({ store, time: '2026-11-12T03:30:00Z' }).calls.length, 0);
});

test('outside-window status can recognize a manual seventh check-in and plan tomorrow off', () => {
  const result = run({ time: '2026-11-11T06:00:00Z', continueDay: 7,
    answer: path => path === CHECK ? { data: { m: 2054, d: { IsCheckIn: true } } } : null });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK, DETAIL]);
  assert.equal(JSON.parse(result.store[STATE]).restDay, '2026-11-12');
  assert(result.notices[0][2].includes('明天停签一天'));
});

test('rest survives token refresh and still applies when the cron is first opened at noon', () => {
  const first = run({ continueDay: 6 });
  first.store.beiwaitan_token = 'new-fake-token';
  const rest = run({ store: first.store, time: '2026-11-12T04:00:00Z' });
  assert.equal(rest.calls.length, 0);
  assert.equal(rest.notices[0][1], '今日停签一天');
});

test('missed scheduled rest day and a naturally missed day both allow a new cycle', () => {
  const seventh = run({ continueDay: 6 });
  const resumed = run({ store: seventh.store, time: '2026-11-13T03:30:00Z', continueDay: 7 });
  assert.equal(JSON.parse(resumed.store[STATE]).cycleCount, 1);
  const fifth = run({ continueDay: 4 });
  const missed = run({ store: fifth.store, time: '2026-11-13T03:30:00Z', continueDay: 5 });
  assert.equal(JSON.parse(missed.store[STATE]).cycleCount, 1);
});

test('pending and failed submissions do not advance the confirmed count or plan a rest day', () => {
  const first = run({ continueDay: 6, answer: path => path === SIGN ? { error: 'timeout' } : null });
  assert.equal(JSON.parse(first.store[STATE]).status, 'uncertain');
  assert(!JSON.parse(first.store[STATE]).restDay);
  const again = run({ store: first.store, continueDay: 6 });
  assert.deepEqual(again.calls.map(r => r.path), [CHECK]);
  const confirmed = run({ store: first.store, continueDay: 7,
    answer: path => path === CHECK ? { data: { m: 2054, d: { IsCheckIn: true } } } : null });
  assert.equal(JSON.parse(confirmed.store[STATE]).restDay, '2026-11-12');
});

test('invalid server counts and detail errors prevent submission without inventing a cycle', () => {
  for (const continueDay of [undefined, null, '', false, -1, 1.5, {}, 'not a number']) {
    const result = run({ answer: path => path === DETAIL ? { data: { m: 1, d: { ContinueDay: continueDay } } } : null });
    assert.deepEqual(result.calls.map(r => r.path), [CHECK, DETAIL]);
    assert(!JSON.parse(result.store[STATE]).restDay);
    assert(!JSON.parse(result.store[STATE]).cycleDay);
  }
  for (const response of [{ error: 'timeout' }, { data: { m: 320 } }]) {
    const result = run({ answer: path => path === DETAIL ? response : null });
    assert(!result.calls.some(r => r.path === SIGN));
  }
});

test('failure to persist a rest day never falls through to submission', () => {
  const result = run({ continueDay: 7,
    failWrite: (key, value) => key === STATE && JSON.parse(value).status === 'rest' });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK, DETAIL]);
  assert(!result.calls.some(r => r.path === SIGN));
});

test('cycles work across a year boundary using Beijing calendar dates', () => {
  const first = run({ time: '2026-12-31T03:30:00Z', continueDay: 6 });
  assert.equal(JSON.parse(first.store[STATE]).restDay, '2027-01-01');
  assert.equal(run({ store: first.store, time: '2027-01-01T03:30:00Z' }).calls.length, 0);
  const next = run({ store: first.store, time: '2027-01-02T03:30:00Z', continueDay: 7 });
  assert.equal(JSON.parse(next.store[STATE]).cycleCount, 1);
});

test('repeats seven successful days then one off for multiple cycles', () => {
  const store = { beiwaitan_token: 'fake-phone-token' };
  for (let index = 0; index < 17; index++) {
    const time = new RealDate(RealDate.UTC(2026, 10, 1 + index, 3, 30)).toISOString();
    const continueDay = JSON.parse(store[STATE] || '{}').cycleCount || 0;
    const result = run({ store, time, continueDay });
    const resting = index % 8 === 7;
    assert.equal(result.calls.filter(r => r.path === SIGN).length, resting ? 0 : 1);
    assert.equal(JSON.parse(store[STATE]).status, resting ? 'rest' : 'signed_in');
    if (!resting) assert.equal(JSON.parse(store[STATE]).cycleCount, index % 8 + 1);
  }
});

test('asynchronous status, detail, rules and sign callbacks preserve the seventh-day plan', async () => {
  const result = await run({ continueDay: 6, defer: true });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK, DETAIL, RULE, SIGN]);
  assert.equal(JSON.parse(result.store[STATE]).restDay, '2026-11-12');
  assert.equal(run({ store: result.store, time: '2026-11-12T03:30:00Z' }).calls.length, 0);
});

test('server count that remains above seven does not shorten subsequent seven-day cycles', () => {
  const store = { beiwaitan_token: 'fake-phone-token' };
  for (let index = 0; index < 17; index++) {
    const time = new RealDate(RealDate.UTC(2026, 10, 1 + index, 3, 30)).toISOString();
    const result = run({ store, time, continueDay: 7 + index });
    const resting = index % 8 === 0;
    assert.equal(result.calls.filter(r => r.path === SIGN).length, resting ? 0 : 1);
    if (!resting) assert.equal(JSON.parse(store[STATE]).cycleCount, index % 8);
  }
});
