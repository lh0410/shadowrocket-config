// Shadowrocket http-request 脚本，需启用 requires-body。
// 仅提取北外滩国客中心凭据到手机本地，不上传、不修改请求。
(function () {
  function report(title, message) {
    console.log("[北外滩 Token] " + title + "：" + message);
    if (typeof $notification !== "undefined" && typeof $notification.post === "function") {
      $notification.post("北外滩国客中心", title, message);
    } else {
      console.log("[北外滩 Token] 当前运行环境未提供通知接口。");
    }
  }

  try {
    console.log("[北外滩 Token] 脚本开始运行。");
    if (typeof $request === "undefined" || !$request || !$request.url) {
      report("脚本测试成功", "当前没有真实请求上下文。请保存配置后，重新打开小程序的签到页面触发提取。");
      return;
    }
    if (!/^https:\/\/m\.mallcoo\.cn\/api\//i.test($request.url)) {
      report("测试或非目标请求", "当前 URL 不属于 m.mallcoo.cn/api/。手动测试可能使用模拟请求，请以打开小程序后的实际触发为准。");
      return;
    }
    if (typeof $request.body !== "string" || !$request.body.trim()) {
      if (String($request.method).toUpperCase() === "GET") {
        console.log("[北外滩 Token] 跳过无正文的 GET 请求。");
        return;
      }
      report("未读到请求正文", "请使用 http-request 类型，开启需要 Body，并关闭二进制模式。");
      return;
    }
    var body = JSON.parse($request.body);
    if (Number(body.MallId == null ? body.MallID : body.MallId) !== 11949) {
      console.log("[北外滩 Token] 跳过商城标识不匹配的请求。");
      return;
    }
    var token = body.Header && body.Header.Token;
    if (typeof token !== "string" || !token.trim()) {
      console.log("[北外滩 Token] 请求中没有 Header.Token，请确认小程序已登录。");
      return;
    }
    var saved = false;
    try {
      saved = typeof $persistentStore !== "undefined" && $persistentStore.write(token, "beiwaitan_token");
    } catch (error) {
      console.log("[北外滩 Token] 本地保存失败，仍尝试显示提取结果。");
    }
    var notifiedToken = null;
    try {
      notifiedToken = typeof $persistentStore !== "undefined" && $persistentStore.read("beiwaitan_last_notified_token");
    } catch (error) {
      console.log("[北外滩 Token] 无法读取通知去重状态。");
    }
    if (notifiedToken === token) {
      console.log("[北外滩 Token] 已捕获相同 Token，跳过重复通知。");
      return;
    }
    report(saved ? "Token 已提取并保存" : "Token 已提取但未保存", token);
    if (typeof $notification !== "undefined" && typeof $notification.post === "function" && typeof $persistentStore !== "undefined") {
      $persistentStore.write(token, "beiwaitan_last_notified_token");
    }
  } catch (error) {
    // 避免将完整请求或解析异常正文写入日志。
    console.log("[北外滩 Token] 处理失败，请确认脚本内容完整且请求正文为 JSON。");
    try {
      if (typeof $notification !== "undefined") {
        $notification.post("北外滩国客中心", "提取失败", "请确认脚本内容完整且请求正文为 JSON。");
      }
    } catch (notificationError) {
      console.log("[北外滩 Token] 通知调用失败，请查看 Shadowrocket 和 iOS 通知设置。");
    }
  } finally {
    $done({});
  }
})();
