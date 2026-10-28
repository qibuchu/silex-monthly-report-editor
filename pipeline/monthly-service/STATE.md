# MCP 服务开发接续入口

## 当前版本：0.2.0（2026-10-16）

当前架构与验收以README.md、CHAT.md、DEPLOY.md及《问题修复与验收-2026-10-16.md》为准。18个MCP工具，新增AI页面/对象结构操作、保留原生编辑状态、全库备份恢复和单实例存储锁。下方为历史开发日志，其工具数量、旧路径与待开发项不能作为当前状态判断。

## 2026-10-15 Demo 后续完善

- PPTX上传增强及真实原月报验收完成，入口/能力边界见PPTX上传说明与验收.md。原始文件67.8MB，9页、6表格、5图表、32图片对象；24份去重资源，保存项目约1.45MB。导出HTML较大（GIF保留），资源归档重导入已验证。
- 服务新增asset-store.mjs及图片上传/读取路由；export.json附去重assets字典，导入重写为新项目资源路径。旧无assets归档仍兼容。
- 原生table标签和每页宽高进入通用格式，渲染/适配/打印遵守宽高。PPT表格固定行高，文字可裁切，不撑高。请勿去掉这些元数据导致表格或纵横比在导出时丢失。
- 测试验收项目e0191588-13ae-4127-b8c5-2231f010ca13，截图、统计及归档在work/pptx-import-acceptance。非正式月报，不覆盖原人工稿。

- 已接通本地AI聊天直接修改，当前17个工具。浏览器3秒上报页面/选择/dirty状态，上下文20秒失效，不写入项目库。多项目无法判定时返回候选。
- apply_object_patch直接保存为ai-chat版本，restore_project_version形成恢复版本；未保存保护及baseRevision检查均保留。
- 同步远端更新保留当前页，并在下载完成后再次检查dirty状态，防止下载期间开始的人工编辑被覆盖。
- 本机Codex已注册steam-monthly。当前会话未加载新工具可用chat.cjs，同源带版本接口，不直接写store。
- 服务测试2项通过（含真实MCP传输），Silex客户端/服务端/资源构建与lint通过；完整Jest129通过、3个既有Windows路径差异失败。真实Demo第二页选中s2o11，经聊天直接加临时文字后网页自动显示且停留第二页，随后只恢复该对象文字。截图和证据在work/demo-acceptance-2026-10-15/chat-*。

- 工具现为14个：新增 rename_project、reject_proposal、cancel_ai_request。
- propose_object_patch 可关联 requestId；需求 pending → proposed → applied，取消为 cancelled。放弃最后一份方案后回到 pending。默认需求队列不含已完成/取消历史。
- 工作台查看需求与方案、复制给本地AI、取消与放弃、过期方案提示、项目重命名、已有项目版本/时间自动更新。
- 下方2026-10-12内容为历史记录。当前原生Silex双向编辑、表格工具及Demo链路以 DEMO.md 为准。

日期：2026-10-12。目标：本地 AI 通过 MCP 主导生成和修改，服务器网页精修、预览与确认。

## 已实现并验证

- 独立 4320 服务、Streamable HTTP MCP，官方 SDK 提供握手和工具发现。
- 11 个工具：list_projects、generate_monthly_report、get_task、get_project、propose_object_patch、apply_proposal、get_preview_link、list_versions、export_project、list_ai_requests、get_ai_request。
- 每项目独立版本与历史，409 保留冲突副本，不覆盖人工内容。
- 异步草稿任务；本地 stdio bridge 支持 dataFile 上传 skill JSON，避免原始包展开进聊天。
- 网页与 MCP 共用项目库。现有 monthly-editor/shared-project.js 仅在 URL 含 project 参数时切换新服务接口；旧 4317 行为保留。
- 真实 8 月包通过本地 bridge 生成成功。演示项目 ID：756ccc6e-6bde-4c89-89dc-0df1239895fb；网页保存后 MCP 读到 v2。
- npm test 官方 MCP 客户端覆盖生成、提案副本预览、应用、旧方案409、版本历史、冲突保存、网页与导出接口、服务重开数据。

## 单一数据源

新服务 store 位于 dataDir/store.json，仅通过 core 接口写；与 workflow/projects/current.json 分开。禁止直接拷贝项目覆盖活动库。待与 Silex 集成时需统一读写和版本检查，不能依赖单向目录导入。

## 待开发

1. Silex 双向适配已实现基础版（2026-10-12）：ui=native 保留原生布局，加 PPT 和 AI；serviceProject/serviceUrl 连接同一带版本项目。真实保存后仍为5页84对象，AI标记需求可由 MCP 读取。后续继续验证复杂新增组件、图片上传、PPT导入后的双向往返。
2. 提案工具扩展到新建/删除对象、容器子对象，仍需稳定 ID 与版本保护。
3. 个人身份、项目权限、审计和多用户部署；当前单访问令牌仅用于内部试用。
4. 服务器环境与客户端 MCP 配置安装包，当前终端需自行添加URL或bridge命令。
5. 草稿长游戏名的表格分页、离线图片资产与缺失数据。

不要修改原人工月报或旧 shared current.json 来演示新服务。测试使用临时存储目录，测试完成后校验路径再清理。

本轮内容修复：榜单正文继承模板粗体的问题已在生成器修正，当前8月项目通过提案和版本检查修正到v3，原生Silex保存后为v4/v5。头部表格实际计算字重验证正文统一400，表头保持粗体。旧记录的9工具已扩展到11工具，新增 list_ai_requests/get_ai_request。

