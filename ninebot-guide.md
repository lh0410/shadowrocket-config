# 九号出行自动签到

已合入现有「walter个人配置」，北外滩任务和个人直连规则继续保留。

## 更新模块

在 Shadowrocket「配置 → 模块」更新现有模块，地址不变：

```text
https://raw.githubusercontent.com/lh0410/shadowrocket-config/main/modules/beiwaitan.sgmodule
```

确认出现「九号参数提取」和「九号每日签到」两条脚本，并更新或重新下载远程脚本缓存。同一模块只启用一份。

## 首次获取参数

1. 开启当前配置的 HTTPS 解密，安装并信任 Shadowrocket 当前使用的证书。模块追加解密域名 `cn-cbu-gateway.ninebot.com`。
2. 保持小火箭运行，登录自己的九号 App，进入签到页面。优先读取状态接口请求头中的 `Authorization` 和 `device_id`；签到请求正文的 `deviceId` 也可读取。
3. 看到「签到参数已保存」通知即表示完整参数已存到手机本地。如果进入页面未触发，可退出重进；仍无通知时，手动签到一次触发 `sign` 请求。
4. 可手动运行「九号每日签到」验证：北京时间 08:00 以后会查询状态，未签到时实际提交；08:00 前仅查询。

提取脚本只读取原请求并原样放行。两个参数必须来自同一条请求，不拼接不同请求中的半份参数。同一组参数不重复通知。手动运行提取脚本显示「脚本已加载」不表示已获取参数。

## 每日执行

- Cron：`5 8-23 * * *`，手机时区为北京时间时，在每天 08:05、09:05 至 23:05 唤醒；首次成功后当天不再请求。
- 首先查询 `status`，仅在 `currentSignStatus` 明确为 `0` 时提交 `sign`，再查询状态确认结果并通知连续签到天数。
- 查询阶段网络失败可等下次任务重试。提交超时、接口异常或结果不明后，当天只查询，不盲目再次提交；请在 App 核对。
- 登录明确过期时暂停使用同一组参数；在 App 重新登录并进入签到页捕获新参数后恢复。
- 内部按 UTC+8 判断日期；Cron 时区由客户端决定。保持手机北京时间、联网和小火箭运行；iOS 暂停后台或整日未运行时，无法保证当天签到。
- 若 App 无法正常加载签到页，可暂时关闭该域名的解密，检查证书与客户端兼容性；未捕获完整参数前无法自动签到。

## 存储和隐私

- `ninebot_account_v1`：Authorization、设备 ID 和参数版本，仅保存当前一组账号参数。
- `ninebot_signin_state_v1`：每日状态、参数版本、设备 ID 和通知去重状态。
- `ninebot_signin_lock_v1`：两分钟运行锁，避免并发执行。

新脚本的日志和通知均不显示 Authorization 或设备 ID，也不将凭据上传 GitHub。参数过期后须由手机重新捕获，仓库更新不能替代登录。

接口、参数和状态字段参考开源项目 [waistu/Ninebot](https://github.com/waistu/Ninebot) 的 [sign_ninebot.js](https://github.com/waistu/Ninebot/blob/main/sign_ninebot.js)，改写为 Shadowrocket 的原生请求、持久化和通知接口，无需 Node.js、青龙或 Bark。
