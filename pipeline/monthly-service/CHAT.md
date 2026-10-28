## 网页选择草稿后直接聊天（2026-10-26）

在“AI 与设置”复制全局 MCP 地址与 Codex 接入命令，在本地终端配置一次；访问令牌通过本地环境变量 `REPORT_SERVICE_TOKEN` 提供，不写入网页配置或聊天。此后在“我的月报”点击“使用 AI 修改”，或在“模板库”点击“使用 AI 修改”切换目标，均复用同一连接，无需为每个模板重新添加 MCP。选择标识不是凭据；访问令牌不进入说明文本。无需保持编辑器打开，也能读取和修改已保存内容。

每次修改前调用 get_editing_context，MCP 地址的 editingTargetId 会自动绑定目标。未绑定地址的客户端必须显式传 editingTargetId；CLI 使用 REPORT_EDITING_TARGET、--target 或 REPORT_SERVICE_URL 中的同名查询参数。不能通过全站最近打开的项目推断用户选择。不同浏览器使用不同标识；不是用户账号权限隔离。服务重启保留明确选择，但不会恢复过期的编辑器在线状态。

网页“取消选择”会让该连接返回 no_selection。切换目标后，旧项目的修改会被该绑定连接拒绝；人工未保存或版本冲突保护仍有效。网页不会主动启动或控制本地模型；已连接的本地 AI 在用户聊天时调用服务。

模板聊天先调用 `get_template_ai_target`，再调用 `get_visual_rule_context`；月报聊天先调用 `get_editing_context`。模板与月报的选择相互独立，AI 不能仅凭“最近打开”猜测用户要改哪个。模板画布上点击对象会更新同一浏览器的全局模板目标。网站能集中显示连接命令与当前目标，但浏览器无法静默安装本机 Codex；首次配置仍需在本地终端执行一次。

# 通过本地 AI 聊天修改

## 操作方式

启动 Demo，在 Silex 打开月报。回到已连接月报 MCP 的本地 AI 终端，直接说：

- “把第二页右侧介绍的字号小一点，其他位置不动。”
- “把我选中的标题改成‘本月重点游戏’。”
- “将这个游戏名改成简称 CS2。”
- “撤销你刚才的修改。”

不需要先在网站填写AI需求或复制指令。选中对象是辅助定位，直接指定页码和内容也可以。AI读取对象并带版本号保存，网页空闲时约5秒加载更新，保留当前页。多个编辑项目无法判定时，AI需要确认目标。

网页存在未保存修改时，AI请求会被拒绝，请先完成编辑并等待保存。页面正在下载远端更新时如果开始手动编辑，也不会被下载结果覆盖。尚未加载新脚本的旧页面需要在保存后刷新一次。

2026-10-20保存修复：服务项目编辑停止约0.8秒后启动自动保存，也可点击顶栏“保存月报”或按Ctrl+S。按钮显示“有未保存修改”“正在保存”“已保存 vN”或“保存失败，点击重试”。只有服务器确认后才显示已保存；失败时保留画布和未保存保护。导出会等待实际保存完成。保存过程中继续输入的内容保留为未保存，后续保存接续提交。不要刷新尚未保存的旧页面。

## 本地 AI 接入

### WorkBuddy（当前推荐）

在“AI 与设置”复制 WorkBuddy 自定义 MCP 配置示例，合并到用户级 `~/.workbuddy/mcp.json` 的 `mcpServers` 中，或在 WorkBuddy 的连接器 / MCP 管理界面添加。填入由管理员提供的访问令牌并在 WorkBuddy 中信任该连接器；不要把真实令牌写入月报网页、聊天或示例文件。用户级配置只需一次，之后网页切换月报或模板即可复用。先在 WorkBuddy 聊天中说“读取我选中的模板”验证。自动 PPT 识别的常驻 worker 目前仍由 Codex CLI 执行；WorkBuddy 聊天修改不依赖该 worker。

本机的 WorkBuddy“月报工作台”配置已通过只读 MCP 握手和工具检查。维护者可运行 `node pipeline/monthly-service/verify-workbuddy.mjs` 重查连接；脚本只输出工具数量和当前目标，不输出访问令牌。

### Codex（可选）

工作台现分为“工作台”“我的月报”“模板库”“AI 与设置”。编辑器顶栏的“← 工作台”返回项目列表；存在未保存内容时，先显示“保存并返回工作台”，实际保存成功后才离开。保存失败或保存期间继续输入时保留当前画布。

本机已执行：`codex mcp add steam-monthly --url http://127.0.0.1:4320/mcp`。

新机器可执行同一命令，再运行 `codex mcp get steam-monthly` 检查。配置方式参考 [OpenAI Docs MCP 官方说明](https://developers.openai.com/learn/docs-mcp)。若已有聊天尚未看到新工具，重开会话；本项目同时提供无需重开会话的CLI通道。

其他支持HTTP MCP的本地终端添加上述URL。stdio客户端可用本目录 mcp-bridge.mjs。无需在月报网站配置模型API密钥；模型由用户的本地AI终端提供。

## AI 调用流程

1. get_editing_context：获得 projectId、revision、pageIndex（从0开始）、selectedObjectIds、对象摘要及dirty状态。状态 ambiguous 或 no_editor 时，不猜目标；可按用户明确指定项目传 projectId。
2. get_project：读取需要修改的对象，尽量通过 objectIds 缩小读取范围，避免将图片字体的大段base64展开到聊天中。
3. apply_object_patch：传 projectId、刚读取的 baseRevision、requirement、changes。支持已有对象的content/style/name，不直接改磁盘项目库。返回 previousRevision 和新revision。
4. 网页自动加载新版本。若用户还在手动编辑，不替换其画布。
5. 用户要求撤销时读取最新版、核对之后是否有人工作过，再用 restore_project_version 恢复对应历史，形成新版本。恢复不会删除历史。

仍可使用propose_object_patch预览方案，但直接聊天修改不强制走网页确认。

结构操作使用apply_structure_patch，传projectId、baseRevision、requirement及operations。支持add_object/remove_object/duplicate_object/move_object和add_page/remove_page/duplicate_page/move_page。pageIndex与index从0开始；index省略时追加，move_page必须指定index。复制和新增对象由服务生成新ID，返回addedObjectIds。一次操作批量原子保存；任一失败均不写入项目。保留至少一页。

例如新增文字：`{"projectId":"项目ID","baseRevision":当前版本,"requirement":"在第二页增加说明","operations":[{"op":"add_object","pageIndex":1,"object":{"attributes":{"data-kind":"text","data-name":"说明"},"style":{"left":"80px","top":"160px","width":"600px","height":"100px","font-size":"24px"},"content":"<p>说明文字</p>"}}]}`。新增图片可使用同一方式，content为带src的img，图片必须来自已上传资源或可归档的数据URI，不能引用操作者本机磁盘路径。

内容或样式修改只更新指定原生组件，其余组件、字体、符号和项目设置保留；明确替换content时该对象内部结构被替换。渲染和数据真实性仍需分别验收。

## 当前聊天的CLI通道

```
node pipeline/monthly-service/chat.cjs context
node pipeline/monthly-service/chat.cjs get_project --input work/read-args.json --output work/read-result.json
node pipeline/monthly-service/chat.cjs apply_object_patch --input work/change-args.json --output work/change-result.json
```

更换服务器时设置 REPORT_SERVICE_URL，启用访问令牌时设置 REPORT_SERVICE_TOKEN。脚本只通过带版本检查的接口写入。
