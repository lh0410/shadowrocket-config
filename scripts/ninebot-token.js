// Shadowrocket http-request；Authorization 和设备 ID 仅保存在手机本地。
// API 参数参考 https://github.com/waistu/Ninebot 。不修改原请求。
(function () {
  var KEY = "ninebot_account_v1";
  function log(message) { console.log("[九号参数] " + message); }
  function notify(title, message) {
    log(title + "：" + message);
    if (typeof $notification !== "undefined") { $notification.post("九号出行", title, message); }
  }
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name) { return String(headers[keys[i]] || "").trim(); }
    }
    return "";
  }
  try {
    if (typeof $request === "undefined" || !$request || !$request.url) {
      notify("脚本已加载", "尚未获取参数，请打开九号 App 的签到页面触发真实请求。");
      return;
    }
    if (!/^https:\/\/cn-cbu-gateway\.ninebot\.com\/portal\/api\/user-sign\/v2\/(status|sign)(?:\?|$)/i.test($request.url)) { return; }
    var authorization = header($request.headers, "authorization");
    var deviceId = header($request.headers, "device_id");
    var bodyId = "";
    if (typeof $request.body === "string" && $request.body.trim()) {
      try {
        var body = JSON.parse($request.body);
        if (body && (typeof body.deviceId === "string" || typeof body.deviceId === "number")) {
          bodyId = String(body.deviceId).trim();
        }
      } catch (parseError) { log("正文不是 JSON，尝试使用请求头中的设备 ID。"); }
    }
    if (deviceId && bodyId && deviceId !== bodyId) {
      notify("参数不一致", "请求头和正文中的设备 ID 不一致，本次未保存，请重新进入签到页面。");
      return;
    }
    deviceId = deviceId || bodyId;
    if (!authorization || !deviceId || /^Bearer\s*$/i.test(authorization)) {
      log("当前请求缺少完整的 Authorization 或 device_id，请登录并重新打开签到页。");
      return;
    }
    var previous = JSON.parse($persistentStore.read(KEY) || "null");
    if (previous && previous.authorization === authorization && previous.deviceId === deviceId) {
      log("参数未变化，保留已有凭据。"); return;
    }
    var account = { authorization: authorization, deviceId: deviceId, revision: String(Date.now()) + "-" + Math.random() };
    if (!$persistentStore.write(JSON.stringify(account), KEY)) {
      notify("参数保存失败", "请检查 Shadowrocket 本地存储，然后重新打开签到页面。"); return;
    }
    notify("签到参数已保存", "已获取 Authorization 和设备 ID，每天 11:00–12:00 内随机签到；参数仅保存在本机。");
  } catch (error) {
    notify("参数提取失败", "请检查脚本、本地存储及 HTTPS 解密配置，然后重新打开九号签到页面。");
  } finally { $done({}); }
})();
