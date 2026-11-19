// 北外滩国客中心凭据提取和每日签到（Shadowrocket）。
// Cron：*/5 11 * * *；引擎 jsc；脚本超时 60 秒。
// 使用请求触发时保存的 beiwaitan_token；时间按北京时间判断。
// 11:00–11:55 随机选择一个 5 分钟时点；窗口外运行只查询，不补签。
// 连续签到满 7 天后停签一天；结合服务端连续天数和本机停签日期恢复周期。
(function () {
  var START_HOUR = 11;
  var TOKEN_KEY = "beiwaitan_token";
  var STATE_KEY = "beiwaitan_signin_state_v1";
  var LOCK_KEY = "beiwaitan_signin_lock_v1";
  var BASE = "https://m.mallcoo.cn";
  var CHECK = "/api/user/user/CheckinBefore";
  var DETAIL = "/api/user/User/GetCheckinDetail";
  var RULE = "/api/user/Checkin/GetCheckinRuleBasicInfo";
  var SIGN = "/api/user/User/CheckinV2";
  var incomingRequest = typeof $request === "undefined" ? null : $request;
  if (incomingRequest || (typeof $argument !== "undefined" && $argument === "capture")) {
    captureRequest(incomingRequest);
    return;
  }

  var state = {};
  var stateLoaded = false;
  var finished = false;
  var ownsLock = false;
  var owner = String(Date.now()) + "-" + Math.random();
  var token;

  function reportCapture(title, message) {
    console.log("[北外滩 Token] " + title + "：" + message);
    if (typeof $notification !== "undefined" && typeof $notification.post === "function") {
      $notification.post("北外滩国客中心", title, message);
    }
  }

  function captureRequest(request) {
    try {
      if (!request || !request.url) {
        reportCapture("脚本已加载", "请打开小程序的签到页面触发真实请求。");
        return;
      }
      if (!/^https:\/\/m\.mallcoo\.cn\/api\//i.test(request.url)) { return; }
      if (typeof request.body !== "string" || !request.body.trim()) {
        if (String(request.method).toUpperCase() !== "GET") {
          reportCapture("未读到请求正文", "请检查模块是否已启用正文读取。");
        }
        return;
      }
      var body = JSON.parse(request.body);
      if (!body || Number(body.MallId == null ? body.MallID : body.MallId) !== 11949) { return; }
      var token = body.Header && body.Header.Token;
      if (typeof token !== "string" || !token.trim()) { return; }
      if (token === $persistentStore.read(TOKEN_KEY)) { return; }
      if (!$persistentStore.write(token, TOKEN_KEY)) {
        reportCapture("Token 保存失败", "请检查小火箭本地存储，然后重新打开签到页面。");
        return;
      }
      reportCapture("Token 已提取并保存", "签到凭据已保存在当前手机。");
    } catch (error) {
      console.log("[北外滩 Token] 提取失败，请检查请求正文和本地存储。");
    } finally {
      $done({});
    }
  }

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
      body: JSON.stringify(fields), timeout: 12
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

  function dayAfter(day, amount) {
    return new Date(Date.parse(day + "T00:00:00Z") + amount * 86400000).toISOString().slice(0, 10);
  }

  function validDay(day) {
    return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && dayAfter(day, 0) === day;
  }

  function countDays(value) {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
      throw problem("cycle", "无法读取连续签到天数，本次未提交，请在小程序核对。");
    }
    var count = Number(value);
    if (!isFinite(count) || count < 0 || Math.floor(count) !== count) {
      throw problem("cycle", "连续签到天数异常，本次未提交，请在小程序核对。");
    }
    return count;
  }

  function markDone(status, day, count) {
    state.day = day;
    state.status = status;
    state.cycleDay = day;
    state.cycleCount = count;
    if (count >= 7) { state.restDay = dayAfter(day, 1); }
    else { delete state.restDay; }
    save();
  }

  function rest(day) {
    state.day = day;
    state.status = "rest";
    state.restDay = day;
    save();
    notify(day + ":rest", "今日停签一天", "连续签到已满7天，今天不提交签到，明天北京时间11–12点恢复。停签日请勿在小程序或其他设备签到。");
    finish();
  }

  function afterBreak(day) {
    return (validDay(state.cycleDay) && dayAfter(state.cycleDay, 1) < day) ||
      (validDay(state.restDay) && state.restDay < day && (!validDay(state.cycleDay) || state.cycleDay < state.restDay));
  }

  function cycleCount(serverCount, day, signedToday) {
    if (afterBreak(day)) { return signedToday ? 1 : 0; }
    if (state.cycleDay === dayAfter(day, -1)) { return state.cycleCount + (signedToday ? 1 : 0); }
    return serverCount;
  }

  function rewardMessage(result) {
    function text(value) {
      if (typeof value !== "string" && !(typeof value === "number" && isFinite(value))) { return ""; }
      return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    var message = text(result.Msg);
    var content = text(result.Content);
    if (content && message.indexOf(content) === -1) {
      var unit = result.RewardType === 1 && /^\d+(\.\d+)?$/.test(content) ? "积分" : "";
      message += (message ? "\n" : "") + "本次奖励：" + content + unit;
    }
    if (!message) { message = "接口已确认今日签到成功，未返回奖励明细。"; }
    var description = text(result.Desc);
    if (description && message.indexOf(description) === -1) { message += "\n" + description; }
    if (result.IsGiveSucess === false) { message += "\n奖励发放尚未确认，请在小程序核对。"; }
    return message;
  }

  function savedReward(day) {
    return state.rewardDay === day && typeof state.rewardMessage === "string" ? state.rewardMessage : "";
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
    token = $persistentStore.read(TOKEN_KEY);
    if (typeof token !== "string" || !token.trim()) {
      notify("missing-token", "尚未获取 Token", "请先打开小程序，让现有提取脚本保存 Token。");
      finish(); return;
    }
    token = token.trim();
    if (state.expiredToken === token) { log("等待更新 Token，未继续发送请求。"); finish(); return; }
    if (state.expiredToken) { delete state.expiredToken; save(); }
    var now = clock();
    var inWindow = now.hour === START_HOUR;
    if (((state.cycleDay == null) !== (state.cycleCount == null)) ||
        (state.cycleDay != null && (!validDay(state.cycleDay) || state.cycleDay > now.day)) ||
        (state.cycleCount != null && countDays(state.cycleCount) !== state.cycleCount) ||
        (state.restDay != null && !validDay(state.restDay))) {
      throw problem("cycle", "本地签到周期记录异常，本次未提交，请检查存储。");
    }
    if (state.restDay === now.day ||
        (state.cycleCount >= 7 && validDay(state.cycleDay) && dayAfter(state.cycleDay, 1) === now.day)) {
      rest(now.day); return;
    }
    if (inWindow) {
      if (state.day !== now.day) {
        state.day = now.day;
        state.minute = Math.floor(Math.random() * 12) * 5;
        state.status = "pending";
        save();
      }
      if ((state.status === "signed_in" || state.status === "already_signed_in") && state.cycleDay === now.day) {
        log("今日已完成，不重复提交。" + (savedReward(now.day) ? "\n" + savedReward(now.day) : "")); finish(); return;
      }
      if (now.minute < state.minute) {
        log("今日计划 " + START_HOUR + ":" + (state.minute < 10 ? "0" : "") + state.minute + " 执行，暂未到时间。");
        finish(); return;
      }
    }
    post(CHECK, {MallId: 11949, IsCheckMemberCard: true}, function (checked) {
      if (checked.IsCheckIn === true) {
        var already = function (count) {
          if (count < 1) { throw problem("cycle", "今日已签到，但连续天数不一致，请在小程序核对。"); }
          markDone("already_signed_in", now.day, count);
          if (!inWindow) {
            var detail = savedReward(now.day) || "本次状态查询未返回奖励明细，请在小程序查看。";
            notify(now.day + ":status:done", "状态检查通过", "Token 有效，今日已签到。每天北京时间 " + START_HOUR + "–" + (START_HOUR + 1) + " 点内随机检查执行。\n" + detail + (count >= 7 ? "\n连续签到已满7天，明天停签一天。" : ""));
          }
          else { log("服务端确认今日已签到，跳过提交。" + (count >= 7 ? "明天停签一天。" : "")); }
          finish();
        };
        if (state.cycleDay === now.day && typeof state.cycleCount === "number") { already(state.cycleCount); }
        else { post(DETAIL, {MallID: 11949}, function (detail) { already(cycleCount(countDays(detail.ContinueDay), now.day, true)); }); }
        return;
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
      post(DETAIL, {MallID: 11949}, function (detail) {
        var serverCount = countDays(detail.ContinueDay);
        var previousCount = cycleCount(serverCount, now.day, false);
        if (previousCount >= 7) { rest(now.day); return; }
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
            state.rewardMessage = rewardMessage(result);
            state.rewardDay = now.day;
            markDone("signed_in", now.day, previousCount + 1);
            notify(now.day + ":success", "签到成功", state.rewardMessage + (state.cycleCount >= 7 ? "\n连续签到已满7天，明天停签一天。" : ""));
            finish();
          });
        });
      });
    });
  }

  try { begin(); }
  catch (error) { fail(error); }
})();
