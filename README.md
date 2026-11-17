# shadowrocket-config

个人 Shadowrocket 模块和脚本。凭据及运行状态保存在手机本地。

## walter个人配置

[个人模块原始链接](https://raw.githubusercontent.com/lh0410/shadowrocket-config/main/modules/beiwaitan.sgmodule)

已有订阅直接更新此模块即可，同时包含北外滩和九号，无需另装一份。

## 九号出行

[使用说明](ninebot-guide.md)

自动提取签到请求中的 Authorization 和设备 ID；每天北京时间 11:00–12:00 内随机选择一分钟签到，当天计划保持不变，完成后跳过，窗口外不补签。登录过期时通知重新获取参数。

## 北外滩国客中心

[使用说明](beiwaitan-guide.md) · [模块原始链接](https://raw.githubusercontent.com/lh0410/shadowrocket-config/main/modules/beiwaitan.sgmodule)

在 Shadowrocket「配置 → 模块」中添加模块链接，启用 HTTPS 解密，并停用旧的同类任务。模块自动加载远程脚本，无需复制本地 JS 文件。

每天北京时间 11–12 点随机执行，连续签到满7天后停签1天，隔天恢复循环；按接口连续天数衔接当前进度。停签日请勿在小程序或其他设备签到。Token 过期时通知重新登录小程序并获取。

仓库仅包含通用配置和脚本，不包含 Token、抓包记录或证书。
