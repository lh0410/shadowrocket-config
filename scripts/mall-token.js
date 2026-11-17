// Shadowrocket http-request：百联、万象、龙湖参数仅存于本机，不修改原请求。
// 协议参考见 mall-guide.md；只提取用户真实请求中的登录和设备参数。
(function () {
  var brand = "", name = "商场签到";
  function header(name) {
    var headers = $request.headers || {}, keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase()) { return String(headers[keys[i]] || "").trim(); }
    }
    return "";
  }
  function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function form(value) {
    var result = {};
    String(value || "").split("&").forEach(function (part) {
      var index = part.indexOf("=");
      if (index < 0) { return; }
      result[decodeURIComponent(part.slice(0, index).replace(/\+/g, " "))] = decodeURIComponent(part.slice(index + 1).replace(/\+/g, " "));
    });
    return result;
  }
  function notice(title, message) {
    console.log("[" + name + "参数] " + title + "：" + message);
    $notification.post(name, title, message);
  }
  try {
    if (typeof $request === "undefined" || !$request || !$request.url || $request.method === "OPTIONS") { return; }
    var url = $request.url, account, data, fields, i;
    if (/^https:\/\/mh5\.bl\.com\/h5_gateway\//i.test(url)) {
      brand = "bailian"; name = "i百联";
      var token = header("membertoken");
      if (!token) { return; }
      account = { membertoken: token, devicekey: header("devicekey"), smDeviceid: header("sm-deviceid"), userAgent: header("user-agent") };
    } else if (/^https:\/\/app\.mixcapp\.com\/mixc\/(gateway|api\/v4\/member\/getPersonalData)(?:\?|$)/i.test(url)) {
      brand = "mixc"; name = "一点万象";
      data = form(url.split("?")[1]);
      if (typeof $request.body === "string" && $request.body.trim()) {
        var posted = /^\s*\{/.test($request.body) ? JSON.parse($request.body) : form($request.body);
        Object.keys(posted).forEach(function (key) { data[key] = posted[key]; });
      }
      fields = ["token", "mallNo", "imei", "deviceParams", "appVersion", "osVersion"];
      if (fields.some(function (key) { return typeof data[key] !== "string" || !data[key].trim(); })) {
        console.log("[一点万象参数] 参数尚不完整，请进入“我的万象星 → 签到”页面。"); return;
      }
      account = {};
      fields.concat(["appId", "platform", "apiVersion", "X-Mixc-Swimlane"]).forEach(function (key) {
        if (typeof data[key] === "string") { account[key] = data[key]; }
      });
      if (/\/mixc\/gateway(?:\?|$)/i.test(url) && account.platform && account.platform !== "h5") { return; }
      account.platform = "h5";
      account.userAgent = header("user-agent");
    } else if (/^https:\/\/gw2c-hw-open\.longfor\.com\/lmarketing-task-api-mvc-prod\/openapi\/task\/v1\/signature\/(page-info|clock)(?:\?|$)/i.test(url)) {
      brand = "longhu"; name = "龙湖天街";
      data = JSON.parse($request.body || "{}");
      if (!object(data) || typeof data.activity_no !== "string" || !/^\d+$/.test(data.activity_no)) { return; }
      var userToken = header("x-lf-usertoken") || header("token") || header("lmtoken");
      var dx = header("x-lf-dxrisk-token"), apiKey = header("x-gaia-api-key");
      if (!userToken || !dx || /^(undefined|null)$/i.test(dx) || !apiKey) {
        console.log("[龙湖参数] 尚缺登录或设备参数，请在 App 或小程序进入签到页；如有验证码，请手动完成后重新进入。"); return;
      }
      var headers = {};
      fields = ["X-LF-UserToken", "token", "lmToken", "X-LF-DXRisk-Token", "X-LF-DXRisk-Source", "X-LF-Bu-Code", "X-LF-Bucode", "X-LF-Channel", "X-GAIA-API-KEY", "X-Client-Type", "User-Agent", "Origin", "Referer"];
      for (i = 0; i < fields.length; i++) {
        var value = header(fields[i]);
        if (value) { headers[fields[i]] = value; }
      }
      // 验证码和旧时间戳/签名不保存、不复用。仅使用真实捕获的设备标识。
      account = { token: userToken, activity: data.activity_no, headers: headers, signedHeaders: !!header("x-longzhu-sign") };
      if (account.signedHeaders && headers["X-Client-Type"] !== "microApp" && headers["X-Client-Type"] !== "app") {
        console.log("[龙湖参数] 当前签名版本无法识别，未保存，请核对新版接口。"); return;
      }
    } else { return; }
    var key = "mall_" + brand + "_account_v1";
    var previous = JSON.parse($persistentStore.read(key) || "null");
    if (previous && !object(previous)) { throw new Error("凭据格式异常"); }
    if (previous) {
      var comparable = {};
      Object.keys(previous).forEach(function (key) { if (key !== "revision") { comparable[key] = previous[key]; } });
      if (JSON.stringify(comparable) === JSON.stringify(account)) {
        var state = JSON.parse($persistentStore.read("mall_" + brand + "_state_v1") || "{}");
        if (state.blockedRevision !== previous.revision) { return; }
      }
    }
    account.revision = String(Date.now()) + "-" + Math.random();
    if (!$persistentStore.write(JSON.stringify(account), key)) { throw new Error("存储写入失败"); }
    notice("签到参数已保存", "参数仅保存在本机，每天北京时间 11:00–12:00 内随机签到。获取成功不代表已完成签到。");
  } catch (error) {
    notice("参数未保存", "请检查本地存储，并重新打开对应 App 的签到页；本次未覆盖已有参数。");
  } finally { $done({}); }
})();
