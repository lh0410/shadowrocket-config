const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../scripts/beiwaitan-signin.js', 'utf8');

const STATE = 'beiwaitan_signin_state_v1';
const CHECK = '/api/user/user/CheckinBefore';
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
      write: (value, key) => { if (value === null) delete store[key]; else store[key] = value; return true; }
    },
    $notification: { post: (...args) => notices.push(args) },
    $done: () => { done++; },
    $httpClient: { post: (request, callback) => {
      const path = new URL(request.url).pathname;
      calls.push({ path, body: JSON.parse(request.body) });
      assert.equal(calls.at(-1).body.Header.Token, store.beiwaitan_token);
      let result = { m: 1, d: path === CHECK ? { IsCheckIn: false, IsOpenCheckin: true } : path === RULE ? { IsOpenCheckinForPosition: false } : { IsCheckIn: true, Content: '3' } };
      const custom = options.answer && options.answer(path, calls.length);
      if (custom && custom.advanceTo) instant = RealDate.parse(custom.advanceTo);
      if (custom && custom.error) { callback(custom.error, null, null); return; }
      if (custom && custom.data) result = custom.data;
      if (custom && custom.beforeReply) custom.beforeReply(store);
      if (path === SIGN) assert.equal(JSON.parse(store[STATE]).status, 'submitting');
      callback(null, { status: custom?.status || 200 }, JSON.stringify(result));
    } }
  };
  vm.runInNewContext(source, context);
  assert.equal(done, 1);
  assert(!logs.join('\n').includes('fake-phone-token'));
  assert(!JSON.stringify(notices).includes('fake-phone-token'));
  return { store, calls, notices, logs };
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
  assert.deepEqual(first.calls.map(r => r.path), [CHECK, RULE, SIGN]);
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
  const statusAnswer = () => ({ data: { m: 2054, d: { IsCheckIn: true } } });
  const sameDay = run({ store: first.store, time: '2026-11-11T06:00:00Z', answer: statusAnswer });
  assert(sameDay.notices[0][2].includes('本次奖励：3'));
  const nextDay = run({ store: first.store, time: '2026-11-12T06:00:00Z', answer: statusAnswer });
  assert(!nextDay.notices[0][2].includes('本次奖励：3'));
  assert(nextDay.notices[0][2].includes('本次状态查询未返回奖励明细'));
  assert.deepEqual(nextDay.calls.map(r => r.path), [CHECK]);
});

test('already checked in with m=2054 is accepted', () => {
  const result = run({ answer: () => ({ data: { m: 2054, d: { IsCheckIn: true } } }) });
  assert.deepEqual(result.calls.map(r => r.path), [CHECK]);
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
  const third = run({ store: first.store, answer: () => ({ data: { m: 2054, d: { IsCheckIn: true } } }) });
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
