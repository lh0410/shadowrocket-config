// 仅供复制到手机本地编辑并手动运行。不要把填写后的脚本上传或分享。
// 只填写要更新的项；只补短信码时，手机号和密码可以留空。
var SGCC_PHONE = "";
var SGCC_PASSWORD = "";
var SGCC_SMS = "";
var SGCC_RESET_LOGIN = false; // 短信超时或主动重新验证登录时，改为 true 运行一次。

(function () {
  function set(value, key) { if (!$persistentStore.write(value, key)) throw new Error('write'); }
  try {
    var phone = String(SGCC_PHONE || '').trim().replace(/^\+?86(?=1\d{10}$)/, '');
    var password = String(SGCC_PASSWORD || ''), sms = String(SGCC_SMS || '').trim();
    if ((!phone && !password && !sms && !SGCC_RESET_LOGIN) || (phone && !/^1\d{10}$/.test(phone)) || (sms && !/^\d{6}$/.test(sms))) {
      $notification.post('网上国网', '未保存', '请在此手机本地脚本填写正确的手机号和密码，或填写6位短信验证码。'); return;
    }
    if ((phone || password) && !(phone || $persistentStore.read('sgcc_phone'))) {
      $notification.post('网上国网', '未保存', '请同时填写手机号和密码。'); return;
    }
    if ((phone || password) && !(password || $persistentStore.read('sgcc_password'))) {
      $notification.post('网上国网', '未保存', '请同时填写手机号和密码。'); return;
    }
    if (phone) set(phone, 'sgcc_phone');
    if (password) set(password, 'sgcc_password');
    if (phone || password || SGCC_RESET_LOGIN) set('true', 'sgcc_reset_login');
    if (sms) set(sms, 'sgcc_sms');
    $notification.post('网上国网', '本地配置已保存', '请手动运行个人模块中的“网上国网每日签到”验证登录；账号密码没有发送到网络。');
  } catch (error) { $notification.post('网上国网', '保存未完成', '请检查本地存储，再重新填写并保存；不要分享已填写的脚本。'); }
  finally { $done(); }
})();
