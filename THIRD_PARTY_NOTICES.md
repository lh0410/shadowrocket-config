# 第三方代码声明

`scripts/sgcc-signin.js` 的国网协议、加密与设备令牌部分取自：

- [MaYIHEI/paperclip/app/sgcc/sgcc.js](https://github.com/MaYIHEI/paperclip/blob/main/app/sgcc/sgcc.js)，原始文件 blob SHA：`387c660afd5b44d932121e9d8e5f23a0a0512b16`。
- 原脚本注明登录、加密与设备令牌代码来自脑瓜（@anker1209）的 [githubdulong/Script/Scriptable/SGCC.js](https://github.com/githubdulong/Script/blob/master/Scriptable/SGCC.js)，协议及设备令牌算法源自 [stevenjoezhang/hass-state-grid](https://github.com/stevenjoezhang/hass-state-grid)。

stevenjoezhang 的 MIT 许可证原文保留在 `sgcc-signin.js` 的协议段内。MaYIHEI 对其修改和仓库结构的许可证如下：

```text
MIT License

Copyright (c) 2026 MaYIHEI

This repository contains scripts collected and adapted from various
open-source authors. Original copyrights are retained by their respective
authors and noted in each script's header comments and the corresponding
README files. The license below applies to the modifications and the
repository structure made by MaYIHEI.

---

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
