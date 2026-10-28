# 月报服务器与 MCP 0.2

本机演示优先使用根目录 `启动月报Demo.cmd` 和 [Demo使用说明](DEMO.md)：统一工作台已提供8月演示生成、项目导入、连接检查与生成任务恢复。

当前主交互是[本地AI聊天直接修改](CHAT.md)。现有27个MCP工具，包含上下文、对象与页面修改、历史恢复、[可编辑模板库及Excel/接口实际数据匹配](TEMPLATES.md)。用户直接描述修改需求即可保存到项目并同步网页，提案确认流程为可选。

新机器安装与发布、备份恢复和内网部署见 [DEPLOY.md](DEPLOY.md)。`node tools/prepare-demo.cjs`检查本机依赖、构建与生成器一致性；`tools/package-demo.cjs`生成不含凭据和用户项目的完整源码交付目录。

PPTX上传已增强主题、富文本、母版背景、图片裁切及常见图表，并完成原始9页月报的导入保存往返验收，见 [PPTX上传说明与验收](PPTX上传说明与验收.md)。媒体资源按内容去重存储；HTML和可编辑归档可携带图片。

协议与传输采用[官方 MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

同一项目存储同时供 MCP 和网页读写。默认本机 4320，与现有 Silex 的 6805、旧共享服务的 4317 分开。不会覆盖 workflow/projects/current.json。

## 启动

先准备独立生成器包：从仓库根目录运行 `node tools/package-monthly.cjs releases/monthly-toolkit-portable`（目录已存在时不需要再打包）。进入本目录运行 `npm ci`，然后 `npm start`。或在依赖已安装后双击仓库根目录“启动月报MCP服务.cmd”。

打开 http://127.0.0.1:4320 。服务器 MCP 地址为 http://127.0.0.1:4320/mcp，使用 Streamable HTTP。config.example.json 可复制为 config.json；相对路径以配置文件所在目录解析。REPORT_SERVICE_CONFIG 可指定不同配置文件。

## 本地 AI 接入

支持 HTTP MCP 的终端直接添加 `/mcp` 地址。若服务设置了访问令牌，客户端添加 Authorization: Bearer 令牌；令牌通过 REPORT_SERVICE_TOKEN 环境变量提供，不写入仓库配置。

推荐使用本地 stdio 连接器，以文件形式传送 skill 输出：MCP 客户端的启动命令为 node，参数为本目录 mcp-bridge.mjs 的绝对路径。环境变量 REPORT_SERVICE_URL 指向服务器 `/mcp`，REPORT_SERVICE_TOKEN 与服务器一致；本机未配置令牌时省略。

AI 使用步骤：

1. 用本地 SteamAuto skill 获取目标月的数据包，保持计算口径。
2. 调用 generate_monthly_report，参数 month 和 dataFile（连接器本地文件路径），不展开整个 JSON 到聊天中。直接 HTTP 模式则提交 data 对象或让服务器自行取数。
3. get_task 等待 succeeded 后获取 projectId。
4. get_project 读取页面与对象摘要，再按 pageIndex/objectIds 读取具体对象。
5. 常规聊天修改使用apply_object_patch提交baseRevision与changes，结构操作使用apply_structure_patch。网页未保存时等待保存；409须重读合并，不能强行覆盖。
6. 用户要求先预览时，才使用propose_object_patch；处理标记需求附requestId。确认后apply_proposal。直接聊天修改不强制经过提案。
7. export_project 返回 HTML 与可编辑 JSON 下载链接。

其他工具：list_projects、get_preview_link、list_versions、list_ai_requests、get_ai_request、rename_project、reject_proposal、cancel_ai_request、get_editing_context、apply_object_patch、apply_structure_patch、restore_project_version。模板工具：list_templates、get_template、create_template、publish_template。当前共22个工具，没有删除项目工具。

list_ai_requests 默认只返回待处理和待确认需求；传 status=all 可获取历史。关联方案应用成功后，需求改为已完成；放弃最后一个待确认方案时，需求重新等待AI处理。取消需求会关闭其待确认方案，保留历史，不修改月报正文。旧版本未关联 requestId 的方案不自动推断对应需求。

生成任务默认使用 finished-eight 成品基础结构，包含8个基础页面，长表格自动续页。profile 可选择 data-supported（5页）或 full（旧9页）。selection.movement_appid 与 selection.indie_appids 显式选择专题游戏；未选择时保留空结构，图片和复杂文案留空。图片槽可双击打开原生替换窗口。

## 原生 Silex 编辑

网站“可视化编辑”现在跳转到原生 Silex 界面，保留原生页面、对象树、组件、样式面板和撤销功能，增加 PPT 上传与 AI 标记入口。Silex 服务需单独启动，默认地址 localhost:6805，可通过 silexUrl 配置。

Silex 直接加载服务器项目并通过 baseRevision 写回同一项目，保留完整 Silex 状态及通用月报格式。AI 应用修改后，编辑器无本地未保存内容时自动加载；有本地修改则提示冲突，不替换。文件上传以图片 data URI 留在可编辑项目中，避免依赖操作人员的本机路径。

点击“AI 标记与需求”，标记对象、描述需求，提交给服务器 AI。服务保存对象 ID、需求及提交版本；本地 AI 用 list_ai_requests / get_ai_request 读取，再用 get_project 和 propose_object_patch 工作。细粒度选中的文字映射到所属月报对象，以便修改范围与通用对象 ID 一致。

## 网页与版本

每个项目都有独立 ID、版本号和历史。网站与 MCP 共用同一服务；网页保存通过baseRevision检查，冲突提交保存在data/conflicts。对象patch保留原生状态并只修改指定对象；structure工具新增或复制会生成新ID，不覆盖既有对象ID。复制的原生对象保留子组件和样式，ID重新分配。

当前服务器网页默认使用 Silex 双向接入，其通用项目格式仍是 steam-grapesjs-v2；legacy-editor 路径保留旧网页编辑器。此前通过目录导入的独立 Silex 项目不会自动并入服务器，必须从项目服务的编辑链接打开。

## 服务器部署

将配置 host 改为 0.0.0.0 时必须设置 REPORT_SERVICE_TOKEN。publicUrl 设置为实际服务器地址，并通过 HTTPS 反向代理提供访问。单一访问令牌只适合小范围内部试用；个人账号、项目权限和审计管理尚未完成。不要把默认无令牌本机服务直接暴露到公网。

服务端取数：配置 generationConfig 指向独立生成器的配置文件，其 Python、skill 和数据服务凭据位于服务器。未配置时通过本地连接器提交数据文件。

## 验证与边界

`npm test`使用官方MCP客户端与独立临时存储，验证生成、聊天、结构操作、原生状态、冲突、导出、持久化、资源归档、备份恢复和单实例锁。演示数据在demo目录，不依赖操作者的历史work目录；需先准备独立生成器包。

当前是可运行试用版；部分上游指标和素材仍缺失，金榜长名称排版仍待处理。HTML 导出包含可见草稿，终稿前还需视觉与业务核验。初稿生成独立包和 SDK 路径不依赖聊天历史。
