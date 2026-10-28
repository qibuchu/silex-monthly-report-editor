# 本地 AI 使用月报工具

先阅读 README.md。生成新草稿只运行 run.cjs，不凭聊天记忆自行复刻版式。

1. 用户给出目标月份后，检查 config.json；如已有统一数据包，使用 --data，避免重复取数。
2. 使用新的输出目录，执行 node run.cjs --month YYYY-MM --data 数据文件 --out 新目录，或使用已配置的数据服务。
3. 阅读 result.json、issues.json、contract.json。上游 partial 和空值不能改成 ok 或 0。头部选取使用上游结果，不放宽规则凑数量。
4. 打开 draft.html 检查实际布局，必要时打开 Silex 独立项目进行人工编辑。结构检查不是视觉验收。
5. 保留 draft.json 和 Silex 项目。用户已有人工稿时，不运行新草稿入口覆盖它；必须使用该项目已有的版本检查接口。
6. 不把凭据、登录 cookie 或 token 写进产出文件，不运行 --recompute，除非用户明确要求重算。
7. 在线取数必须先执行 health 和 databrain-preflight。凭据失效则暂停并请用户续期，收到明确确认后再继续；不使用空榜、0或旧包绕过。CLI退出码3和服务awaiting_credentials均表示等待用户处理。
8. 历史月报禁止当前快照替代。核对报告月、月度对比窗口和上线D0–D13窗口及时区；无相符历史证据的值不填入。阅读data-quality.json和独立缺失文档，原始JSON只作为证据保留。
