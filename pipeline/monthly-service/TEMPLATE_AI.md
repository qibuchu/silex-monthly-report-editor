# PPT 模板的本地 AI 识别

上传 PPTX 后，服务先保留原始可编辑页面，并建立按页面分批的对象识别任务。启发式规则仅作初始建议；本地 AI 分析对象名称、文字、位置和已知绑定，返回固定元素、日期、数据、人工补充或待确认的分类。不会根据样例数值推算公式，也不会把 PCU 当成 DAU。

在运行 Codex CLI 的电脑上，配置月报服务地址与访问令牌后启动识别：

```powershell
$env:REPORT_SERVICE_URL='http://月报服务器:14320'
$env:REPORT_SERVICE_TOKEN='<从管理员安全渠道获取的令牌>'
node pipeline/monthly-service/template-ai-worker.mjs --template '<模板ID>'
```

可提前运行 `node pipeline/monthly-service/template-ai-worker.mjs --watch`，自动处理之后上传的所有模板。加 `--model <本地终端可用模型>` 可指定模型。不要把令牌写入聊天、模板或项目文件。服务只向本地 AI 终端返回解析后的对象摘要；不会向第三方模型 API 发起调用。模板画布每五秒检查结果，AI 建议的低置信度对象需要人工确认。完成识别后仍需核对页面、数据口径和视觉效果，再发布模板。

工作台“AI 与设置”同时展示全局 MCP 接入命令与上述常驻识别器命令。MCP 连接负责聊天修改月报和模板；常驻识别器负责上传后自动分析新 PPT。两者共用服务地址和访问令牌，但首次都必须由本地终端启动，网页不能直接运行用户电脑的 AI 进程。

当前聊天修改的默认本地 AI 是 WorkBuddy，已通过“月报工作台”MCP 连接；本文件的自动识别 worker 仍调用 Codex CLI。两条链路互不依赖，不能把 WorkBuddy 的 MCP 连接状态当作自动识别 worker 已启动。

服务器模型 API 的结构化识别适配器已经隔离在 `template-ai.mjs`，当前服务入口禁止选择服务器模式。确定具体 API 接收方及数据传输授权后，再接入自动执行和配置。
