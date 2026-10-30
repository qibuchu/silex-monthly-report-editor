# 月报统一数据契约 1.0

状态：2026-10-30 冻结为**适配器输入/输出规范**。当前网站仍兼容 SteamAuto schema 2.0 原始包和小游戏接口原始 JSON；本文件不表示适配器已经上线。实现适配器后，以本契约作为数据源进入模板匹配器的唯一标准格式。

## 一句话定义

Skill、JSON 接口和上传文件负责**获取数据**；各自的适配器负责转成 `monthly-data/1.0` JSON；模板只读取规范化的 `metrics` 和 `tables`，并按稳定 ID 绑定字段。模板的标题、版式、人工文案和图片空槽不属于数据契约。

```text
SteamAuto Skill ─┐
小游戏 JSON API ─┼─> 来源适配器 ─> monthly-data/1.0 ─> 窗口/口径校验 ─> 模板字段映射
Excel/CSV/JSON ──┘
```

## 顶层字段

| 字段 | 规则 |
|---|---|
| `contract_version` | 固定 `1.0`。不兼容变更升主版本。 |
| `report_month` | `YYYY-MM`，表示月报目标月，不等于所有明细的日期范围。 |
| `status` | `complete` 或 `partial`；缺失信息必须列在 `missing`。 |
| `producer` | 数据源库 ID、来源版本、适配器版本、原始快照 ID、生成时间。保留上游计算版本。 |
| `scope` | 平台、地区、统计人群/样本范围；不可用同名字段跨不同口径直接比较。 |
| `windows` | 具名时间窗口，起止日期均包含当天。所有指标和表格都必须引用窗口。 |
| `metrics` | 独立指标，数值保留原始类型和明确单位；不得只存格式化字符串。 |
| `tables` | 明细/榜单/图表数据；每行有稳定业务 ID，每列有类型、单位及来源字段。 |
| `missing` | 无法取得或无法确认的字段；以 JSON Pointer 指向空值，说明原因。 |

详见 [schema.json](schema.json)。示例：[SteamAuto](example-steamauto.json)、[小游戏](example-minigame.json)。

## 时间与历史约束

1. `monthly` 窗口须恰好覆盖目标月的第一天至最后一天，时区为 IANA 名称，例如 `Asia/Shanghai`。同比、环比的对照月使用单独窗口。服务不得以当前快照替代历史评测、好评率、定级等状态。
2. `release_d0_d13` 窗口以发售日为 D0，结束日必须为 D13，允许跨入下月。每款游戏独立设置窗口与 `release_date`。
3. 其他窗口用 `custom`，必须写 `purpose` 和日期。`observed_as_of` 表示原始状态截至哪天；如上游不能证明历史状态，指标置 `null` 并登记缺失。
4. `producer.generated_at` 是生成包的时间，不能代替业务统计窗口。接口的 `report_month`、`range` 与包中的目标月不一致时拒绝；没有期间信息时只能由人工明确确认，并在 `producer.window_evidence` 标为 `operator-confirmed`。

## 口径、单位与溯源

- 指标 ID 使用来源命名空间，例如 `steam.market.release_total`、`minigame.iap.revenue`；同一 ID 的含义、单位、公式不可随月份变化。改变公式或统计范围须改 ID 或升 `producer.calculation_version` 并在模板中重新核对。
- `metric.value` 保持数字、布尔、日期/文本或 `null`。比例统一用小数：占比 `0.894` 表示 89.4%，环比可以为负或大于 1。金额使用明确币种（如 `USD`），人数/次数用 `count`。前端负责显示“万”“%”等格式，不在适配器里把 `0.894` 写成 `89.4%`。
- 表格列 `key` 稳定，`label` 可以中文；行 `id` 使用 appid/业务游戏 ID 等，不用数组下标代替身份。`origin.path` 或列的 `source_field` 指向原始包字段；业务计算由上游完成，适配器只搬运和单位标准化，不重新计算收入、榜单、环比、D0–D13 指标。
- 如确实需要适配器做纯格式转换，记录 `origin.transform`；业务公式仍须提供上游 `calculation_id` 和 `calculation_version`。来源本身没有此信息时写 `unknown`，不得编造公式。
- 缺失的数值填 `null`，同时写 `missing` 项；`0` 只表示已证实的零。`missing.reason` 采用 `not_provided`、`window_unavailable`、`credential_expired`、`ambiguous_definition` 或 `source_error`。凭据 401/403 时整个在线取数任务暂停，不产出“部分成功”包。
- PCU 与 DAU 必须使用不同 ID，且 `label` 和 `unit` 准确；PCU 不得标作 DAU。人工分析和外部研究另走内容层，不进入数值指标。

## 适配器边界与迁移

| 来源 | 输入 | 适配器职责 | 当前状态 |
|---|---|---|---|
| SteamAuto | `monthly-report` schema 2.0 标准 JSON | 显式映射 KPI、头部榜、大盘、新游等已有字段，保留 `calculation_version`、`snapshot_id`、统计范围与缺失项 | 待实现；旧生成器仍直接读取原始包 |
| 小游戏 | `/minigame-db/api/report/monthly/export?month=YYYY-MM&format=json` | 显式映射 IAP/IAA/买量表，保留接口给出的排序与计算结果，不自行补 MAU 等缺项 | 待实现；当前模板可直接导入原始 JSON 并人工核对映射 |
| 上传文件 | JSON/CSV/XLSX | 明确指定字段表头、月份、窗口和单位；无法判断口径时拒绝自动映射 | 待实现；目前只可上传样例登记来源并按月导入实际文件 |

数据源库记录**连接定义与字段样例**；每期数据包是独立、不可变的快照，须记录所用 `data_source_id` 和版本。修改来源配置不改已发布模板和历史包。模板发布快照记录数据源版本和字段映射版本。先实现两个适配器，再在导入入口校验 schema 和语义，最后切换模板读取规范包；迁移期间保留旧版路径，不默默改写已有月报。
