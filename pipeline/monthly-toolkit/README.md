# 可分发月报生成工具 0.1

这是独立草稿生成包。代码、固定模板和图表渲染器全部在包内，运行时不读取当前共享月报，不需要开发聊天历史。模板由已有 PPT 风格项目固化，生成使用上游数据替换绑定字段；人工专题内容预留空槽。

## 离线生成

安装 Node.js 18 或以上。准备 SteamAuto skill 输出的 schema_version=2.0 数据包，无需 npm install：

```
node run.cjs --month 2026-08 --data monthly-report.json --out reports/august
```

默认五页数据支撑版；九页含空白研究栏目时加 --full。输出目录已存在则拒绝写入，请换一个新目录。

成品结构使用 `--profile finished-eight`：8个基础页面（含异动和两种独游专题），图片位置为有名称的可替换空槽，复杂文案留空；表格固定行高，长名称单行省略、完整内容保留，仅按行数容量续页，实际页数可能超过8。可加 `--selection selection.json`，内容例如 `{"movement_appid":3932890,"indie_appids":[4001890,1478500]}`。这些只是8月成品案例的选择，其他月份需要重新选择，不是自动选取规则。

输出 draft.json 是可编辑项目；draft.html 是静态草稿预览；issues.json 和“缺失与口径说明.md”独立记录问题；silex-storage 是可交给 Silex 的独立项目，result.json 记录来源与位置。

离线时可加 --history history.json；文件内容是前两个月的完整 monthly-report 数据包组成的数组。没有历史包时，大盘历史定级率和评测总数留空，不从模板继承。

## 自动取数与接入 Silex

取数前会检查服务和DataBrain登录状态。凭据失效时退出码为3，服务任务标记awaiting_credentials，暂停等待用户续期并确认，不自动重试。获取成功后仍检查数据包中的登录错误标记。

历史评测的当前快照不再填入草稿；缺少准确D0–D13日期及时区证据的14日指标也不填入。原始JSON保留，排除清单写入data-quality.json和独立口径文档。获取日期较晚不代表指标无效，关键是指标自己的统计窗口。

将 config.example.json 复制成 config.json。安装 SteamAuto data-query skill 的 Python 依赖，设置数据服务地址与凭据，按该 skill 的说明管理登录续期。这里不提供或包含凭据。

配置 steamautoSkillDir 为 skill 目录，python 为可运行的解释器，silexStorageDir 为你安装的 Silex 文件系统存储目录。相对路径按 config.json 所在目录解析。然后：

```
node run.cjs --month 2026-08 --config config.json --out reports/august
```

程序执行 health、目标月及前两个月的 monthly-report 和目标月上游校验，不重算冻结结果；随后生成并接入 Silex。每次使用新项目 ID，避免覆盖人工稿。启动本项目定制的 Silex 服务后打开 result.json 的 editor_url。

## 重要边界

- 这是生成器包，不包含 Silex 编辑器二进制或 Python 数据 skill，二者要另行安装；完整安装分发仍需完善。
- 成品结构已支持固定行高、长名称省略及按行数容量续表，保留完整文字。已人工修改的分页稿暂不支持整包刷新，应按对象更新或创建独立新稿，避免覆盖布局。
- status=partial 可生成草稿，不能当作数据完整；PCU 不标为 DAU，不客户端另算上游业务指标。
- 空图片和研究文案由人工或 AI 后续补充。本地 AI 自动连接仍未完成。
- Silex 基于 AGPL-3.0；定制源码与许可文件须与编辑器分发一起提供。
- 不要用此命令刷新已经人工修改的 Silex 项目。当前入口只生成新草稿；同月刷新需遵循共享项目的版本检查流程。

