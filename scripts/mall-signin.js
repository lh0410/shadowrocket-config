// Shadowrocket cron：i百联、一点万象、龙湖天街；无外部依赖。
// 接口出处和使用步骤见 mall-guide.md。凭据仅使用本机真实请求提取值。
(function () {
  var brands = [{ id: "bailian", name: "i百联" }, { id: "mixc", name: "一点万象" }, { id: "longhu", name: "龙湖天街" }];
  var started = Date.now(), finished = false;
  function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function pad(value) { return value < 10 ? "0" + value : String(value); }
  function clock(at) {
    var d = new Date((at === undefined ? Date.now() : at) + 8 * 3600000);
    return { day: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
  }
  function done() { if (!finished) { finished = true; $done(); } }
  function issue(kind, message) { var e = new Error(message); e.kind = kind; return e; }
  function b64(value) {
    var bytes = unescape(encodeURIComponent(value)), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes.charCodeAt(i), b = bytes.charCodeAt(i + 1), c = bytes.charCodeAt(i + 2);
      out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
      out += isNaN(b) ? "=" : alphabet[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
      out += isNaN(c) ? "=" : alphabet[c & 63];
    }
    return out;
  }
  // RFC 1321：按 UTF-8 字节计算 MD5，仅用于公开客户端协议的请求签名。
  function md5(value) {
    var text = unescape(encodeURIComponent(value)), words = [], n = text.length, i, j;
    for (i = 0; i < n; i++) { words[i >> 2] = (words[i >> 2] || 0) | (text.charCodeAt(i) << ((i % 4) * 8)); }
    words[n >> 2] = (words[n >> 2] || 0) | (128 << ((n % 4) * 8));
    var length = (((n + 8) >>> 6) + 1) * 16;
    words[length - 2] = n * 8; words[length - 1] = Math.floor(n / 536870912);
    var h = [1732584193, -271733879, -1732584194, 271733878];
    var shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
    for (i = 0; i < length; i += 16) {
      var a = h[0], b = h[1], c = h[2], d = h[3];
      for (j = 0; j < 64; j++) {
        var round = j >> 4, f, index;
        if (round === 0) { f = (b & c) | (~b & d); index = j; }
        else if (round === 1) { f = (d & b) | (~d & c); index = (5 * j + 1) % 16; }
        else if (round === 2) { f = b ^ c ^ d; index = (3 * j + 5) % 16; }
        else { f = c ^ (b | ~d); index = (7 * j) % 16; }
        var sum = (a + f + (Math.floor(Math.abs(Math.sin(j + 1)) * 4294967296) | 0) + (words[i + index] || 0)) | 0;
        var shift = shifts[round][j % 4], oldD = d;
        d = c; c = b; b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0; a = oldD;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    }
    var hex = "";
    for (i = 0; i < 16; i++) { hex += ("0" + ((h[i >> 2] >>> ((i % 4) * 8)) & 255).toString(16)).slice(-2); }
    return hex;
  }
  function form(data) { return Object.keys(data).map(function (key) { return encodeURIComponent(key) + "=" + encodeURIComponent(data[key]); }).join("&"); }
  function numeric(value) { return (typeof value === "number" || typeof value === "string") && /^\d+(\.\d+)?$/.test(String(value)); }
  function safeCode(value) { return /^-?\d+$/.test(String(value)) ? String(value) : "未知"; }
  function verify(result, ok) {
    var code = String(result.code === undefined ? result.resCode : result.code);
    var message = [result.message, result.msg, result.errMsg, result.extraMessage].filter(function (s) { return typeof s === "string"; }).join(" ");
    if (/^(401|403|406|801001|801007|900006)$/.test(code) || /未登录|请.*登录|登录.*(过期|失效)|token.*(invalid|expired|过期|失效|无效)|unauthorized/i.test(message)) {
      throw issue("expired", "登录已失效，请重新登录 App 并进入签到页获取参数。");
    }
    if (/^(801810|801811|801812|8040012|8040016)$/.test(code) || /验证码|滑块|人机|验证失败/.test(message)) {
      throw issue("risk", "需要设备验证，请在 App 手动完成验证，再重新进入签到页获取参数。");
    }
    if (!ok) { throw issue("api", "接口未确认成功，业务码：" + safeCode(code) + "；请在 App 核对。"); }
  }
  function runBrand(brand, next) {
    var prefix = "mall_" + brand.id, stateKey = prefix + "_state_v1", lockKey = prefix + "_lock_v1";
    var state, account, loaded = false, ownsLock = false, ended = false;
    var owner = String(Date.now()) + "-" + Math.random(), today = clock().day;
    function log(message) { console.log("[" + brand.name + "签到] " + message); }
    function save() { if (!$persistentStore.write(JSON.stringify(state), stateKey)) { throw issue("storage", "本地状态保存失败，未继续提交。"); } }
    function notice(key, title, message) {
      log(title + "：" + message);
      if (state.notice === key) { return; }
      $notification.post(brand.name, title, message); state.notice = key; save();
    }
    function end() {
      if (ended) { return; } ended = true;
      if (ownsLock) {
        try {
          var lock = JSON.parse($persistentStore.read(lockKey) || "null");
          if (lock && lock.owner === owner) { $persistentStore.write(null, lockKey); }
        } catch (error) { log("运行锁稍后自动失效。"); }
      }
      next();
    }
    function fail(error) {
      try {
        if (!loaded) { $notification.post(brand.name, "本地状态异常", "已有状态未覆盖，请检查手机本地存储。"); }
        else {
          if (state.status === "signed_in" && brand.id === "mixc") {
            notice(today + ":done", "签到成功", state.reward + "积分余额查询未完成，请在 App 查看。"); end(); return;
          }
          if (state.status === "submitting") { state.status = error.kind === "expired" || error.kind === "risk" ? "pending" : "uncertain"; }
          if (error.kind === "expired" || error.kind === "risk") { state.blockedRevision = account && account.revision; }
          save();
          notice(today + ":" + (error.kind || "local"), "签到需要处理", error.kind ? error.message : "本地执行异常，已停止本次任务，请检查脚本和存储。");
        }
      } catch (storageError) { $notification.post(brand.name, "本地存储异常", "未自动重试提交，请在 App 核对签到状态。"); }
      end();
    }
    function maySubmit() { var now = clock(); return now.day === today && now.hour === 11 && now.minute >= state.minute; }
    function submit() {
      if (!maySubmit()) { throw issue("window", "已超出今日随机签到窗口，本次未提交。"); }
      if (Date.now() - started > 43000) { throw issue("budget", "本次运行时间不足，等待下次计划任务。"); }
      if (state.status === "submitting" || state.status === "uncertain") { throw issue("uncertain", "上次提交结果尚未确认，本日不重复提交，请在 App 核对。"); }
      state.status = "submitting"; save();
    }
    function success(title, message) {
      state.status = "signed_in"; state.reward = message; save();
      notice(today + ":done", title, message); end();
    }
    function http(options, callback) {
      if (Date.now() - started > 43000) { throw issue("budget", "本次运行时间不足，保留状态，等待下次计划任务。"); }
      if (state.status === "submitting" && !maySubmit()) {
        state.status = "pending"; save();
        throw issue("window", "发送前已超出今日签到窗口，本次未提交。");
      }
      options.timeout = 8;
      $httpClient.post(options, function (error, response, body) {
        if (ended) { return; }
        try {
          if (error) { throw issue("network", "网络请求失败；已提交而结果不明时，本日不重复提交，请在 App 核对。"); }
          var status = Number(response && (response.status || response.statusCode));
          if (status === 401 || status === 403) { throw issue("expired", "请求被拒绝，请重新登录 App 并获取参数；如有验证码请在 App 完成。"); }
          if (status !== 200) { throw issue("http", "接口 HTTP 状态异常：" + status + "，请在 App 核对。"); }
          var result;
          try { result = JSON.parse(body); } catch (parseError) { throw issue("response", "响应不是有效 JSON，未继续提交。"); }
          if (!object(result)) { throw issue("response", "接口响应结构异常，未继续提交。"); }
          callback(result);
        } catch (caught) { fail(caught); }
      });
    }
    function bailian() {
      if (!maySubmit()) { log("窗口外未提交，请等待每日随机计划。"); end(); return; }
      submit();
      var headers = { "Content-Type": "application/json", channelid: "1", chnflg: "app-h5", membertoken: account.membertoken, Origin: "https://mh5.bl.com", Referer: "https://mh5.bl.com/bl-front-end/pages/mypoints/myPoints?hidebar=true" };
      if (account.devicekey) { headers.devicekey = account.devicekey; }
      if (account.smDeviceid) { headers["sm-deviceid"] = account.smDeviceid; }
      if (account.userAgent) { headers["User-Agent"] = account.userAgent; }
      http({ url: "https://mh5.bl.com/h5_gateway/signIn/submitSignInv2.htm", headers: headers, body: JSON.stringify({ channelId: 1, buId: "3000", shopId: "-1" }) }, function (result) {
        var data = result.obj;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch (error) { data = null; } }
        if (object(data) && typeof data.errMsg === "string") { result.errMsg = data.errMsg; }
        verify(result, result.resCode === "00100000");
        if (!object(data)) { throw issue("response", "提交后缺少签到明细，请在 i百联核对，本日不重复提交。"); }
        if (String(data.signStatus) === "1") { success("今日已签到", "服务端返回今日已签到。"); return; }
        if (!numeric(data.signPoint)) { throw issue("response", "接口未返回可识别的签到奖励，本日不重复提交，请在 App 核对。"); }
        success("签到成功", "本次 +" + data.signPoint + " 积分。" + (numeric(data.keepDays) ? "连续签到 " + data.keepDays + " 天。" : ""));
      });
    }
    function mixcCall(action, callback) {
      var ms = Date.now(), now = clock(ms), data = {
        mallNo: account.mallNo, appId: account.appId || "68a91a5bac6a4f3e91bf4b42856785c6", platform: "h5", imei: account.imei,
        appVersion: account.appVersion, osVersion: account.osVersion, action: action, apiVersion: account.apiVersion || "1.0",
        timestamp: String(ms + 2), deviceParams: account.deviceParams, "X-Mixc-Swimlane": account["X-Mixc-Swimlane"] || "s1", t: String(ms),
        date: now.day + " " + pad(now.hour) + ":" + pad(now.minute) + ":" + pad(now.second), token: account.token, params: b64(JSON.stringify({ mallNo: account.mallNo }))
      };
      data.sign = md5(Object.keys(data).sort().map(function (key) { return key + "=" + data[key] + "&"; }).join("") + "P@Gkbu0shTNHjhM!7F");
      var headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json, text/plain, */*", Origin: "https://app.mixcapp.com", Referer: "https://app.mixcapp.com/m/m-" + account.mallNo + "/signIn?mallNo=" + account.mallNo };
      if (account.userAgent) { headers["User-Agent"] = account.userAgent; }
      http({ url: "https://app.mixcapp.com/mixc/gateway", headers: headers, body: form(data) }, callback);
    }
    function mixc() {
      // latticeList 只有余额/连签，不含可信的今日状态；不能用奖励布局推断已签。
      if (!maySubmit() || state.status === "uncertain" || state.status === "submitting") {
        mixcCall("mixc.app.memberSign.latticeList", function (result) {
          verify(result, result.code === 0 || result.code === "0");
          notice(today + ":query", "状态查询完成", "凭据可用；此接口无法确认今日是否已签，请在 App 核对。每日仅在 11–12 点随机提交一次。"); end();
        }); return;
      }
      submit();
      mixcCall("mixc.app.memberSign.sign", function (result) {
        var message = String(result.message || result.msg || "");
        if (/今日已签到|今天已签到|已签过|已经签到|不可重复签到/.test(message)) { success("今日已签到", "服务端返回今日已签到。"); return; }
        verify(result, result.code === 0 || result.code === "0");
        var data = result.data;
        if (!object(data)) { throw issue("response", "提交后缺少签到明细，本日不重复提交，请在 App 核对。"); }
        var point = object(data.signDataMap) && data.signDataMap.todayPoint !== undefined ? data.signDataMap.todayPoint : data.point;
        if (!numeric(point)) { throw issue("response", "接口未返回可识别的签到奖励，本日不重复提交，请在 App 核对。"); }
        state.status = "signed_in"; state.reward = "本次 +" + point + " 积分。"; save();
        // 签到回包 userPoints 不是余额；真实余额只读 latticeList.remaindPoints。
        mixcCall("mixc.app.memberSign.latticeList", function (latest) {
          verify(latest, latest.code === 0 || latest.code === "0");
          var info = object(latest.data) ? latest.data : {}, tail = "";
          if (numeric(info.remaindPoints)) { tail += "当前积分 " + info.remaindPoints + "。"; }
          if (numeric(info.currentStep)) { tail += "连续签到 " + info.currentStep + " 天。"; }
          success("签到成功", state.reward + tail);
        });
      });
    }
    function longhuCall(endpoint, callback) {
      var body = { activity_no: account.activity }, headers = {}, saved = account.headers;
      Object.keys(saved).forEach(function (key) { headers[key] = saved[key]; });
      headers["Content-Type"] = "application/json;charset=UTF-8";
      if (account.signedHeaders) {
        var client = headers["X-Client-Type"], secret = client === "microApp" ? "Q74eKtH5LePYfSjIiflUbCL2gxjTa7rF" : client === "app" ? "20jtGtg5TQ9V1A3Q4RsxBzJqb@^WUS%m" : "";
        if (!secret) { throw issue("params", "当前签名版本无法识别，请重新获取参数。"); }
        var stamp = String(Date.now());
        headers["X-LONGZHU-TimeStamp"] = stamp;
        headers["X-LONGZHU-Sign"] = md5("activity_no=" + account.activity + "&" + stamp + "&" + secret);
      }
      http({ url: "https://gw2c-hw-open.longfor.com/lmarketing-task-api-mvc-prod/openapi/task/v1/signature/" + endpoint, headers: headers, body: JSON.stringify(body) }, function (result) {
        verify(result, result.code === "0000"); callback(result.data);
      });
    }
    function longhuStatus(data) {
      if (!object(data) || !Array.isArray(data.seven_days_signs)) { throw issue("response", "签到日历结构无法识别，未继续提交。"); }
      if (data.current_date_time !== undefined && data.current_date_time !== null) {
        var serverTime = Number(data.current_date_time);
        if (!isFinite(serverTime) || clock(serverTime).day !== today) { throw issue("date", "服务器日期与本机日期不一致，未继续提交。"); }
      }
      for (var i = 0; i < data.seven_days_signs.length; i++) {
        var item = data.seven_days_signs[i];
        if (!object(item)) { continue; }
        var date = String(item.sign_year) + "-" + pad(Number(item.sign_month)) + "-" + pad(Number(item.sign_day));
        if (date === today) {
          if (Number(item.sign_status) === 20) { return true; }
          if (Number(item.sign_status) === 10) { return false; }
        }
      }
      throw issue("response", "未识别到今天的明确签到状态，未继续提交。");
    }
    function longhu() {
      longhuCall("page-info", function (data) {
        if (longhuStatus(data)) { success("今日已签到", state.reward || "签到日历已确认今日签到。"); return; }
        if (!maySubmit()) { notice(today + ":query", "状态查询完成", "今日尚未签到，等待每天 11–12 点随机执行；窗口外不补签。"); end(); return; }
        submit();
        longhuCall("clock", function (data) {
          state.status = "uncertain";
          var rewards = object(data) && Array.isArray(data.reward_info) ? data.reward_info : [];
          var lines = [];
          rewards.forEach(function (reward) {
            // 只显示接口明确给出的单位，不把成长值误报成可消费珑珠。
            if (object(reward) && numeric(reward.reward_num)) {
              var label = reward.reward_name || reward.rewardName || "奖励（单位以 App 为准）";
              if (typeof label !== "string" || label.length > 40 || /[\r\n]|https?:|token/i.test(label)) { label = "奖励（单位以 App 为准）"; }
              lines.push(label + " +" + reward.reward_num);
            }
          });
          state.reward = lines.length ? lines.join("；") + "。" : "本次奖励请在 App 查看。"; save();
          longhuCall("page-info", function (latest) {
            if (!longhuStatus(latest)) { throw issue("uncertain", "提交后日历仍未确认已签，本日只查询、不重复提交，请在 App 核对。"); }
            success("签到成功", "签到日历已确认。" + state.reward);
          });
        });
      });
    }
    try {
      state = JSON.parse($persistentStore.read(stateKey) || "{}");
      if (!object(state)) { throw new Error("状态格式异常"); } loaded = true;
      account = JSON.parse($persistentStore.read(prefix + "_account_v1") || "null");
      if (!account) { notice("missing", "尚未获取签到参数", "请登录对应 App 并打开签到页，参数获取后自动加入每日任务。"); end(); return; }
      var required = brand.id === "bailian" ? ["membertoken", "revision"] : brand.id === "mixc" ? ["token", "mallNo", "imei", "deviceParams", "appVersion", "osVersion", "revision"] : ["token", "activity", "revision"];
      if (!object(account) || required.some(function (key) { return typeof account[key] !== "string" || !account[key].trim(); }) ||
          (brand.id === "longhu" && (!object(account.headers) || !account.headers["X-LF-DXRisk-Token"] || !account.headers["X-GAIA-API-KEY"]))) {
        throw issue("params", "凭据不完整，请重新打开 App 的签到页获取参数。");
      }
      if (state.blockedRevision === account.revision) { log("等待重新获取登录或设备验证参数。"); end(); return; }
      var lock = JSON.parse($persistentStore.read(lockKey) || "null");
      if (lock && lock.expires > Date.now()) { log("已有任务运行，跳过。"); end(); return; }
      if (!$persistentStore.write(JSON.stringify({ owner: owner, expires: Date.now() + 120000 }), lockKey)) { throw issue("storage", "无法保存运行锁。"); }
      ownsLock = true;
      lock = JSON.parse($persistentStore.read(lockKey) || "null");
      if (!lock || lock.owner !== owner) { end(); return; }
      if (state.day !== today) { state = { day: today, status: "pending", minute: Math.floor(Math.random() * 60) }; save(); }
      if (state.status === "signed_in") { log("今日已签到，跳过。"); end(); return; }
      if (typeof state.minute !== "number" || state.minute % 1 || state.minute < 0 || state.minute > 59) { throw issue("storage", "今日随机计划异常，未重新抽签，请检查本地状态。"); }
      var now = clock();
      if (now.hour === 11 && now.minute < state.minute) { log("今日计划 11:" + pad(state.minute) + " 执行，尚未到时间。"); end(); return; }
      if (brand.id === "bailian") { bailian(); } else if (brand.id === "mixc") { mixc(); } else { longhu(); }
    } catch (error) { fail(error); }
  }
  function step(index) {
    if (index >= brands.length || Date.now() - started > 43000) { done(); return; }
    runBrand(brands[index], function () { step(index + 1); });
  }
  step(0);
})();
