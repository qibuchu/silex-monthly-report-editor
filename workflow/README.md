# 月报工作流入口（当前版）

当前使用4320月报项目服务与6805原生Silex编辑器。启动根目录“启动月报Demo.cmd”，打开 http://127.0.0.1:4320/ 。准备新机器：`node tools/prepare-demo.cjs --install --build`，需要Node.js 24+及pnpm 10.34.4。

- [服务与使用说明](../pipeline/monthly-service/README.md)
- [本地AI聊天修改协议](../pipeline/monthly-service/CHAT.md)
- [安装、备份恢复与服务器部署](../pipeline/monthly-service/DEPLOY.md)
- [数据窗口核验](当前取数字段与时间窗口核验.md)
- [大盘直取字段规范](大盘直取字段规范.md)：业务值直接来自SteamAuto，月报端只格式化和绘图。
- [可编辑模板库与产出规则](../pipeline/monthly-service/TEMPLATES.md)：选择模板生成新稿，另存模板、可视化编辑、按版本发布。

运营流程：本地skill获取目标月标准数据包（或显式配置服务端取数）→生成独立草稿→Silex与本地AI交替修改→预览→导出HTML及可编辑JSON归档。网页和AI共用版本化项目，冲突重读合并；不能直接改store.json。数据缺失另列文档，历史月份不能使用当前快照。

以下为旧4317单项目服务的历史维护说明，仅用于维护旧项目；不适用于当前网站或MCP。不要将新服务项目覆盖到workflow/projects/current.json，不要运行旧build-fidelity脚本。

---

## 旧4317工作流（历史）

## 启动

需要 Node.js 18+，无额外 npm 安装。双击根目录“启动月报.cmd”，或执行 `node workflow/server.cjs`，打开 http://127.0.0.1:4317 。服务只监听本机，不是内网多人服务。

首次启动将现有月报复制为共享项目。旧 file:// 页面仍只支持下载保存；共同编辑须使用上述HTTP地址。

## 运营与AI接续

1. AI按本地数据Skill取数。当前数据源说明在 D:/steamauto-data-query/SKILL.md，其他机器需自行配置位置与凭据。将原始结果、日期、窗口、来源及缺失项保留在本期资料目录。
2. `node workflow/project.cjs pull work/report-edit.json` 读取最新版本。文件包含 revision 和 project；AI修改 project.deck 中对应对象，不改 revision。
3. 根据现有模板填入本期数据，保留人工排版与已审核文案。新月份可先用网页“打开项目”导入模板，再保存共享版本；上一版本会进入历史。当前只有一个活动项目，不支持同时编辑多份月报。
4. `node workflow/project.cjs check work/report-edit.json` 检查尺寸和越界。该检查不检测文字溢出，不核验业务数据。
5. `node workflow/project.cjs push work/report-edit.json` 提交。版本一致才写入；否则返回409，并保留传入修改为conflict文件。
6. 网页没有未保存修改时，5秒内检测并加载AI更新；有未保存修改时提示冲突，不替换画布。人工点击“保存共享项目”写回同一份项目。不会自动保存未提交修改，关闭前请保存。
7. AI再次pull即可获取人工修改。发生冲突时读取最新版和 workflow/projects/conflict-*.json 按对象ID合并，保留人工修改；同字段冲突须确认。重新以最新版revision提交。
8. 终稿前检查原始数据、缺失清单、全部页面布局、标题脚注、图片与图表。人工确认后使用“导出演示HTML”，同时下载项目副本归档。

### 新月份草稿

标准化数据已准备好时，使用 [生成新月份草稿.md](生成新月份草稿.md) 的 `generate-draft.cjs` 入口。默认生成五页数据支撑版：封面、头部榜单、大盘总览、金银榜和附录铜榜；历史九页结构仅在 `selection.page_mode="full"` 时生成。随后仍须按本文件的 `check`、视觉验收和 `push` 流程处理。不要运行旧的 `build-fidelity.cjs`。

## 版本与恢复

workflow/projects/current.json 是活动版本；revision-N.json 是历史快照。恢复时先pull最新，再把历史快照的project写入下载文件，保留最新revision并push，恢复动作也生成新版本。
GET /api/history 可查看历史编号。不要通过提高revision或直接改磁盘文件跳过冲突保护。数据与历史可能较大，请按实际容量管理备份。

## 边界

已接通本机共享保存、版本历史、AI命令行读写、冲突副本与网页更新提示。数据查询仍使用现有Skill和脚本，并未自动化完整研究判断；缺失数据文档中的项目仍需处理。MCP、账号权限、多人服务、自动字段合并、自动视觉验收尚未实现。
