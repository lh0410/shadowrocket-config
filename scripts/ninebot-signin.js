// 九号出行 Shadowrocket cron；API 参考 https://github.com/waistu/Ninebot 。
// 每天 11:00 开始，每小时检查至 23:00，按北京时间去重。
(function () {
  var ACCOUNT = "ninebot_account_v1";
  var STATE = "ninebot_signin_state_v1";
  var LOCK = "ninebot_signin_lock_v1";
  var BASE = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/";
  var state = {}, loaded = false, finished = false, ownsLock = false;
  var owner = String(Date.now()) + "-" + Math.random();
  var account, today;

  function log(message) { console.log("[九号签到] " + message); }
  function clock() {
    var date = new Date(Date.now() + 8 * 3600000);
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return { day: date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()), hour: date.getUTCHours() };
  }
  function save() {
    if (!$persistentStore.write(JSON.stringify(state), STATE)) { throw new Error("本地状态保存失败。"); }
  }
  function notify(key, title, message) {
    log(title + "：" + message);
    if (state.notice === key) { return; }
    $notification.post("九号出行", title, message);
    state.notice = key; save();
  }
  function finish() {
    if (finished) { return; }
    finished = true;
    try {
      var lock = JSON.parse($persistentStore.read(LOCK) || "null");
      if (ownsLock && lock && lock.owner === owner) { $persistentStore.write(null, LOCK); }
    } catch (error) { log("运行锁将在两分钟后自动失效。"); }
    $done();
  }
  function problem(kind, message) { return { kind: kind, message: message }; }
  function fail(error) {
    try {
      if (!loaded) {
        $notification.post("九号出行", "本地状态异常", "未覆盖已有状态，请检查 " + STATE + "。");
      } else {
        if (state.status === "submitting") { state.status = "uncertain"; }
        if (error.kind === "expired") {
          state.expiredRevision = account.revision;
          // 明确拒绝的提交可以在获取新参数后重试。
          if (state.status === "uncertain" && error.rejected) { state.status = "pending"; }
        }
        save();
        notify(today + ":" + (error.kind || "local"), error.kind === "expired" ? "登录已过期" : "签到需要处理",
          error.message || "本地执行异常，请检查存储和脚本配置。");
      }
    } catch (storageError) {
      log("无法保存状态，已停止本次任务。");
      $notification.post("九号出行", "本地存储异常", "请检查 Shadowrocket 存储；本次未自动重试提交。");
    }
    finish();
  }
  function request(method, path, callback) {
    var options = {
      url: BASE + path + (method === "get" ? "?t=" + Date.now() : ""), timeout: 10,
      headers: {
        "Accept": "application/json, text/plain, */*", "Content-Type": "application/json",
        "Authorization": account.authorization, "device_id": account.deviceId,
        "Origin": "https://h5-bj.ninebot.com", "Referer": "https://h5-bj.ninebot.com/",
        "from_platform_1": "1", "language": "zh",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6 C 609033420"
      }
    };
    if (method === "post") { options.body = JSON.stringify({ deviceId: account.deviceId }); }
    $httpClient[method](options, function (error, response, body) {
      if (finished) { return; }
      try {
        if (error) { throw problem("network", "网络请求失败；已提交但结果不明时，后续只查询状态，请在 App 核对。"); }
        var status = Number(response && (response.status || response.statusCode));
        if (status === 401) {
          var expired = problem("expired", "请在九号 App 重新登录并进入签到页，获取新参数后自动恢复。");
          expired.rejected = method === "post"; throw expired;
        }
        if (status !== 200) { throw problem("http", "接口 HTTP 状态异常：" + status + "，请在 App 核对。"); }
        var result;
        try { result = JSON.parse(body); } catch (parseError) { throw problem("response", "接口未返回有效 JSON，未继续提交。"); }
        if (!result || typeof result !== "object" || Array.isArray(result)) { throw problem("response", "接口响应格式异常。"); }
        if (result.code !== 0 && result.code !== "0") {
          var code = String(result.code);
          var message = typeof result.msg === "string" ? result.msg : "";
          if (code === "401" || /登录.*(过期|失效)|未登录|token.*(expired|invalid|过期|失效)|unauthorized/i.test(message)) {
            var invalid = problem("expired", "请在九号 App 重新登录并进入签到页，获取新参数后自动恢复。");
            invalid.rejected = method === "post"; throw invalid;
          }
          throw problem("api", "接口未确认成功，业务码：" + (/^-?\d+$/.test(code) ? code : "未知") + "；请在 App 核对。");
        }
        callback(result.data);
      } catch (caught) { fail(caught); }
    });
  }
  function signed(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) { throw problem("response", "签到状态数据缺失，未提交。"); }
    var value = data.currentSignStatus;
    if (value !== 0 && value !== 1 && value !== "0" && value !== "1") { throw problem("response", "无法识别今日签到状态，未提交。"); }
    return Number(value) === 1;
  }
  function markDone(data, title) {
    state.status = "signed_in"; save();
    var days = String(data.consecutiveDays);
    notify(today + ":done", title, "服务端确认今日已签到。" + (/^\d+$/.test(days) ? "连续签到 " + days + " 天。" : ""));
    finish();
  }
  function begin() {
    today = clock().day;
    state = JSON.parse($persistentStore.read(STATE) || "{}");
    if (!state || typeof state !== "object" || Array.isArray(state)) { throw new Error("状态格式异常。"); }
    loaded = true;
    var lock = JSON.parse($persistentStore.read(LOCK) || "null");
    if (lock && lock.expires > Date.now()) { log("已有任务正在运行，跳过。"); finish(); return; }
    if (!$persistentStore.write(JSON.stringify({ owner: owner, expires: Date.now() + 120000 }), LOCK)) { throw new Error("无法保存运行锁。"); }
    ownsLock = true;
    lock = JSON.parse($persistentStore.read(LOCK) || "null");
    if (!lock || lock.owner !== owner) { finish(); return; }
    account = JSON.parse($persistentStore.read(ACCOUNT) || "null");
    if (!account || typeof account.authorization !== "string" || !account.authorization.trim() ||
        typeof account.deviceId !== "string" || !account.deviceId.trim() || typeof account.revision !== "string" || !account.revision) {
      notify("missing", "尚未获取签到参数", "请开启 HTTPS 解密，登录九号 App 并打开签到页面。"); finish(); return;
    }
    if (state.expiredRevision === account.revision) { log("等待新的登录参数，未继续请求。"); finish(); return; }
    if (state.day !== today || state.revision !== account.revision) {
      var unresolved = state.day === today && state.deviceId === account.deviceId &&
        (state.status === "submitting" || state.status === "uncertain");
      state = { day: today, revision: account.revision, deviceId: account.deviceId, status: unresolved ? "uncertain" : "pending" };
      save();
    }
    if (state.status === "signed_in") { log("今日已完成，不重复请求。"); finish(); return; }
    request("get", "status", function (data) {
      if (signed(data)) { markDone(data, "今日已签到"); return; }
      if (clock().day !== today || clock().hour < 11) {
        notify(today + ":ready", "状态检查通过", "参数有效，今日尚未签到；每天北京时间 11:00 开始执行。"); finish(); return;
      }
      if (state.status === "submitting" || state.status === "uncertain") {
        throw problem("uncertain", "上次提交结果尚未确认，请在九号 App 核对，本日后续只查询状态。");
      }
      state.status = "submitting"; save();
      request("post", "sign", function () {
        state.status = "uncertain"; save();
        request("get", "status", function (latest) {
          if (!signed(latest)) { throw problem("uncertain", "提交后尚未确认今日已签到，请在九号 App 核对。"); }
          markDone(latest, "签到成功");
        });
      });
    });
  }
  try { begin(); } catch (error) { fail(error); }
})();
