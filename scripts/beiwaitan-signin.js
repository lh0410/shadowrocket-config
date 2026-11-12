// 北外滩国客中心每日签到（Shadowrocket cron）。
// Cron：*/5 11 * * *；引擎 jsc；脚本超时 60 秒。
// 使用提取脚本保存的 beiwaitan_token；时间按北京时间判断。
// 11:00–11:55 随机选择一个 5 分钟时点；窗口外运行只查询，不补签。
(function () {
  var START_HOUR = 11;
  var STATE_KEY = "beiwaitan_signin_state_v1";
  var LOCK_KEY = "beiwaitan_signin_lock_v1";
  var BASE = "https://m.mallcoo.cn";
  var CHECK = "/api/user/user/CheckinBefore";
  var RULE = "/api/user/Checkin/GetCheckinRuleBasicInfo";
  var SIGN = "/api/user/User/CheckinV2";
  var state = {};
  var stateLoaded = false;
  var finished = false;
  var ownsLock = false;
  var owner = String(Date.now()) + "-" + Math.random();
  var token;

  function log(message) {
    console.log("[北外滩签到] " + message);
  }

  function clock() {
    var date = new Date(Date.now() + 8 * 3600000);
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return {
      day: date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()),
      hour: date.getUTCHours(), minute: date.getUTCMinutes()
    };
  }

  function save() {
    if (!$persistentStore.write(JSON.stringify(state), STATE_KEY)) {
      throw new Error("本地状态保存失败，已停止提交。请检查 Shadowrocket 存储。");
    }
  }

  function notify(key, title, message) {
    log(title + "：" + message);
    if (state.notice === key) { return; }
    $notification.post("北外滩国客中心", title, message);
    state.notice = key;
    save();
  }

  function finish() {
    if (finished) { return; }
    finished = true;
    try {
      var lock = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
      if (ownsLock && lock && lock.owner === owner) {
        $persistentStore.write(null, LOCK_KEY);
      }
    } catch (error) { log("清理运行锁失败，将在两分钟后自动失效。"); }
    $done();
  }

  function fail(error) {
    try {
      if (!stateLoaded) {
        log("本地状态无法读取，未提交签到，也未覆盖已有状态。");
        $notification.post("北外滩国客中心", "本地状态异常", "请检查 " + STATE_KEY + "；为避免重复签到，未重置状态。");
        finish(); return;
      }
      if (error.kind === "expired") {
        state.expiredToken = token;
        if (state.status === "submitting") { state.status = "pending"; }
        save();
        notify("expired:" + token, "登录已过期", "请登录小程序并重新提取 Token；旧 Token 已暂停使用，更新后自动恢复。");
      } else {
        if (state.status === "submitting") { state.status = "uncertain"; }
        save();
        notify(clock().day + ":" + (error.kind || "local"), "签到需要处理", error.message || "执行异常，请查看日志。");
      }
    } catch (storageError) {
      log("无法持久化运行状态，请检查本地存储。");
      $notification.post("北外滩国客中心", "本地状态异常", "请检查 Shadowrocket 存储；本次未自动重试签到。");
    }
    finish();
  }

  function problem(kind, message) { return {kind: kind, message: message}; }

  function post(path, fields, callback) {
    fields.Header = {Token: token};
    $httpClient.post({
      url: BASE + path,
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify(fields), timeout: 15
    }, function (error, response, body) {
      if (finished) { return; }
      try {
        if (error) { throw problem("network", "网络请求失败；若签到已提交，下次只核对状态，不盲目重发。"); }
        var status = Number(response && (response.status || response.statusCode));
        if (status === 401) { throw problem("expired", "登录已过期。"); }
        if (status !== 200) { throw problem("http", "接口 HTTP 状态异常：" + status); }
        var data;
        try { data = JSON.parse(body); }
        catch (parseError) { throw problem("response", "接口返回的内容不是有效 JSON。"); }
        if (!data || typeof data !== "object") { throw problem("response", "接口响应格式异常。"); }
        if (data.m === 320) { throw problem("expired", "用户 Token 错误或已过期。"); }
        var already = data.m === 2054 && data.d && data.d.IsCheckIn === true;
        if (data.m !== 1 && !(already && (path === CHECK || path === SIGN))) {
          throw problem("api", "接口业务状态异常：" + (typeof data.m === "number" ? data.m : "未知"));
        }
        if (!data.d || typeof data.d !== "object" || Array.isArray(data.d)) {
          throw problem("response", "接口没有返回预期的数据对象。");
        }
        callback(data.d);
      } catch (caught) { fail(caught); }
    });
  }

  function markDone(status) {
    state.day = clock().day;
    state.status = status;
    save();
  }

  function begin() {
    state = JSON.parse($persistentStore.read(STATE_KEY) || "{}");
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("本地状态格式异常，请检查 " + STATE_KEY + "。");
    }
    stateLoaded = true;
    var lock = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    if (lock && lock.expires > Date.now()) { log("已有脚本正在运行，本次跳过。"); finish(); return; }
    if (!$persistentStore.write(JSON.stringify({owner: owner, expires: Date.now() + 120000}), LOCK_KEY)) {
      throw new Error("无法保存运行锁，未发起签到请求。");
    }
    ownsLock = true;
    lock = JSON.parse($persistentStore.read(LOCK_KEY) || "null");
    if (!lock || lock.owner !== owner) { finish(); return; }
    token = $persistentStore.read("beiwaitan_token");
    if (typeof token !== "string" || !token.trim()) {
      notify("missing-token", "尚未获取 Token", "请先打开小程序，让现有提取脚本保存 Token。");
      finish(); return;
    }
    token = token.trim();
    if (state.expiredToken === token) { log("等待更新 Token，未继续发送请求。"); finish(); return; }
    if (state.expiredToken) { delete state.expiredToken; save(); }
    var now = clock();
    var inWindow = now.hour === START_HOUR;
    if (inWindow) {
      if (state.day !== now.day) {
        state.day = now.day;
        state.minute = Math.floor(Math.random() * 12) * 5;
        state.status = "pending";
        save();
      }
      if (state.status === "signed_in" || state.status === "already_signed_in") {
        log("今日已完成，不重复提交。"); finish(); return;
      }
      if (now.minute < state.minute) {
        log("今日计划 " + START_HOUR + ":" + (state.minute < 10 ? "0" : "") + state.minute + " 执行，暂未到时间。");
        finish(); return;
      }
    }
    post(CHECK, {MallId: 11949, IsCheckMemberCard: true}, function (checked) {
      if (checked.IsCheckIn === true) {
        markDone("already_signed_in");
        if (!inWindow) { notify(now.day + ":status:done", "状态检查通过", "Token 有效，今日已签到。每天北京时间 " + START_HOUR + "–" + (START_HOUR + 1) + " 点内随机检查执行。"); }
        else { log("服务端确认今日已签到，跳过提交。"); }
        finish(); return;
      }
      if (checked.IsCheckIn !== false) { throw problem("response", "无法确认今日签到状态，未提交。"); }
      if (!inWindow) {
        notify(now.day + ":status:ready", "状态检查通过", "Token 有效，今日尚未签到。当前不在北京时间 " + START_HOUR + "–" + (START_HOUR + 1) + " 点，仅查询，不补签。");
        finish(); return;
      }
      if (state.status === "submitting" || state.status === "uncertain") {
        throw problem("uncertain", "上次提交结果未确认，请检查小程序；本脚本不会再次自动提交。");
      }
      if (checked.IsOpenCheckin !== true) { throw problem("closed", "当前未开放签到。"); }
      post(RULE, {MallID: 11949}, function (rules) {
        if (rules.IsOpenCheckinForPosition !== false) {
          throw problem("manual", "位置签到要求已变化或无法确认，请到小程序手动签到。");
        }
        var restricted = ["IsOpenCheckinForPosition", "IsOpenCheckinForWecom", "IsOpenCheckinForGroup"];
        for (var i = 0; i < restricted.length; i++) {
          if (rules[restricted[i]] || checked[restricted[i]]) {
            throw problem("manual", "签到增加了位置、企微或集团条件，请到小程序确认。");
          }
        }
        var submitTime = clock();
        if (submitTime.day !== now.day || submitTime.hour !== START_HOUR) {
          log("已超出执行时段，未提交签到。"); finish(); return;
        }
        state.status = "submitting";
        save();
        post(SIGN, {MallID: 11949, Longitude: 0, Latitude: 0, InMall: 0}, function (result) {
          if (result.IsCheckIn !== true) { throw problem("unconfirmed", "接口未确认签到成功，请在小程序核对。"); }
          markDone("signed_in");
          var reward = typeof result.Content === "string" && /^\d+(\.\d+)?$/.test(result.Content) ? result.Content : "";
          notify(now.day + ":success", "签到成功", reward ? "本次奖励：" + reward + "；具体发放以小程序为准。" : "接口已确认今日签到成功。");
          finish();
        });
      });
    });
  }

  try { begin(); }
  catch (error) { fail(error); }
})();
