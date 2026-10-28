# 月报项目协作入口

先阅读 workflow/README.md 和 outputs/monthly-editor/数据缺失与口径核对.md。
AI和人工共用 workflow/projects/current.json，但禁止直接覆盖该文件。使用 workflow/project.cjs pull/push 通过版本检查读写。
保留原PPT标题、脚注、字体与版式，除非用户要求修改。数据缺失单独输出文档，不能编造。PCU不能标作DAU。
刷新数据仅修改相应数据字段和图表，保留人工文案与布局。不要运行旧 build-fidelity.cjs 覆盖编辑器或共享项目。
发生409冲突时读取最新版及conflict副本，按对象ID合并；无法判断的同字段冲突交给用户，禁止强行重试覆盖。
草稿与终稿必须保留可编辑项目。结构检查不等于视觉验收或数据核验。AI可自主使用代码或工具，但须遵守统一项目格式。
历史月报严格匹配统计时间窗口，不得用当前快照替代历史评测、好评率或月末定级状态；无历史证据的字段留空并写独立缺失文档。上线14日指标按发售日D0至D13逐项核对，允许跨到下月。
每次在线取数先检查DataBrain凭据。发现401/403、JWT/cookie/PAT过期或登录失效时暂停整个取数/生成任务，通知用户续期，等用户明确确认后再继续。不得用空榜、0、旧快照绕过，不自动重算冻结快照。

## 本地AI聊天修改月报

用户选择在 Codex 等本地终端直接聊天修改，网页同步显示。新服务项目使用 http://127.0.0.1:4320/mcp（Codex MCP 名称 steam-monthly），不是旧 workflow/projects/current.json。
先调用 get_editing_context 识别当前项目、页面、选中对象和未保存状态。若多个项目无法确定目标，须确认目标，禁止按最近生成稿猜测。用户明确指定项目时可传 projectId。
读取最新版 get_project 的所需对象后，用户明确要求的常规修改用 apply_object_patch 直接保存，无需要求用户复制需求或再去网页确认提案。保留 baseRevision 检查；dirty=true 或409时等待人工保存并重读，不能强行覆盖。
当前聊天未加载新MCP工具时，使用同一服务的CLI：`node pipeline/monthly-service/chat.cjs context`；通用调用为 `node pipeline/monthly-service/chat.cjs TOOL_NAME --input 参数文件.json --output 结果文件.json`。参数使用JSON文件，不把大段HTML写进shell命令。
返回 previousRevision 可用于用户要求的撤销，通过 restore_project_version 生成恢复版本；如AI修改后又有人工作过，先核对，不能把新的人工修改一起撤销。只在用户要求预览时走 propose_object_patch。接入说明见 pipeline/monthly-service/CHAT.md。
