# 月报服务独立部署 · 2026-10-23

## 当前服务器

- SSH：buchutang@9.135.95.168，端口36000。
- 部署根目录：`/data/home/buchutang/services/steam-monthly`。
- 当前发布以服务器上 `readlink current` 为准；`current` 软链接指向运行版本。
- 工作台：http://9.135.95.168:14320/
- 编辑器：http://9.135.95.168:16805/ ，从工作台项目卡片进入。
- MCP：http://9.135.95.168:14320/mcp
- 项目：Docker Compose `steam-monthly`；容器：`steam-monthly-app`。

当前服务器在 Compose 中显式配置 `REPORT_SERVICE_AUTH_MODE=network`，工作台、编辑器和 MCP 均无需填写共享访问令牌。内网可达的用户现在都能访问及修改项目；接入内网身份凭证前应由网络层限制可达范围。本地 AI 只需配置工作台显示的 MCP URL，stdio 桥接器设置 `REPORT_SERVICE_URL` 即可。令牌模式仍可通过 `REPORT_SERVICE_AUTH_MODE=token` 启用。

服务器原有 `secrets/monthly_token` 继续作为内部加密密钥和 Silex 会话密钥，以便读取既有数据源凭据；它不再是当前部署的访问凭证，不应发给使用者。此文件和运行配置不可提交到源码仓库。

## 隔离范围

只新增上述部署目录、Docker项目网络和两个指定IP端口。未改Nginx、80/443、数据库、宿主Node或其他Compose项目；原有13个容器部署后仍在运行。仅绑定服务器9.135.95.168地址，不使用host网络，不挂载Docker套接字。

容器使用非root用户、只读程序目录、独立持久化state目录、1核CPU/1GB内存上限、160进程上限、日志轮转及unless-stopped重启策略。程序复用Node 24 Alpine镜像；Linux依赖在独立限额安装容器中安装。没有上传本机项目库、DataBrain凭据或SteamAuto登录信息。

共享令牌用于受控试用，不提供个人账号和项目级权限。目前是IP+HTTP部署，尚未配置域名和TLS；需要跨不可信网络访问时应另行配置HTTPS或受控隧道。其他电脑须具备到该服务器网段的访问能力。

## 运维命令

在服务器先执行：

```sh
cd /data/home/buchutang/services/steam-monthly
sudo docker compose -p steam-monthly -f compose.yaml ps
sudo docker logs --tail 80 steam-monthly-app
sudo docker compose -p steam-monthly -f compose.yaml restart app
```

停止或启动只指定本项目：

```sh
sudo docker compose -p steam-monthly -f compose.yaml stop app
sudo docker compose -p steam-monthly -f compose.yaml up -d app
```

禁止使用全局docker stop、prune、删除其他网络或重载其他项目。正常停机时服务关闭HTTP监听并释放数据目录锁；部署验收已验证停机无残留锁、重启后人工内容保留。异常退出（如容器内存超限）后，锁记录的PID可能在重启时被复用：20261031-05起锁同时记录进程启动时间，服务能自行识别并替换这类旧锁，不再崩溃循环。若仍出现锁冲突，先停止并确认所有使用该state目录的实例已停，再保留旧锁副本核对；不能绕过锁并行写入。

大文件导入不要在`steam-monthly-app`容器内运行客户端脚本：脚本与服务共用1.5GB内存上限，2026-10-31曾因此被OOM连续杀死。应在宿主机用curl流式提交（`--data-binary @文件`，令牌用`-K`配置文件传入）。126MB项目按此方式导入的容器内存峰值约1.07GB。

## 持久化与备份

- `state/data`：月报、模板、素材、历史和生成任务。
- `state/backups`：自动/手动完整备份；连续运行每24小时备份，当前无自动保留数量清理。
- `state/editor`：编辑器原生文件存储。
- `state/editor-exports`：预留原生发布目录。
- `runtime/config.json`：地址及存储路径，不含令牌。

工作台“AI与设置→创建完整备份”可手动备份。正式运营应将备份复制到独立位置。更新前先备份并确认没有未保存编辑；在不存在的新release目录部署新包，复用同版本依赖或按锁文件安装，切换current，然后只重建app容器。state与secrets独立保留；不要把store.json复制覆盖到运行库。

从统一云端仓库的干净检出构建。打包入口：`node tools/package-server.cjs releases/server-YYYYMMDD-NN`。构建产物从仓库内 Silex 源码生成，排除旧的主 JS/CSS 哈希文件，附带源提交号和 SHA256 清单。上传压缩包后在服务器执行 `bash current/deployment/steam-monthly/deploy-release.sh YYYYMMDD-NN`。新版本健康后自动保留当前及上一代码发布目录；备份、图片、项目库和凭据不在代码清理范围。生产配置副本关闭 SaaS 引导、FTP 和外部账号连接，仅保留原生编辑器、文件存储和下载。

## 验收

服务器独立生成8月演示月报9页；22个远程MCP工具可连接，AI带版本保存、人工双击编辑保存、HTML与可编辑JSON导出通过。PPT上传用不含业务数据的样例验证创建未发布模板。工作台与编辑器未登录接口返回401，跨来源编辑请求拒绝。正常重启后人工文字仍在。没有进行在线业务取数或历史数据真实性核验。

演示月报：`0ddee0e1-84ab-4ce8-a22c-7e808b742021`；PPT样例模板编辑稿：`e12164ac-8844-49e5-a657-5aacabb038e5`。

本次源码检查：月报服务9项、网关1项测试通过；编辑器lint、构建通过，147项测试通过、2项既有外部夹具测试跳过。内网HTTP环境缺少randomUUID的问题已用Web Crypto随机数兼容修复，未关闭浏览器安全策略。


2026-10-26 PPT数据区优化：当前版本20261026-12。识别文字拼接的两张Top20榜单与六张新游卡片，列映射支持中文字段和来源起始行。9月预览独立项目b73c8b5d-04c1-4fbc-bbff-c82c5d136530，8区295格；原模板发布v2、编辑项目v10及1102个对象ID/样式保持不变。24项服务回归测试通过。已检查两张榜单和新游卡片；本次不是整份报告的内容验收，右侧榜单观察等原模板人工分析未重新生成，不可作为9月结论使用。MAU/MAU环比等缺失见独立文档。

2026-10-26 AI草稿选择：我的月报增加“使用AI修改”、本浏览器当前选择、取消选择和一次性连接说明。MCP地址带editingTargetId，每次get_editing_context读取明确选择，无需编辑器在线；人工未保存、对象版本和换稿后的旧稿写入仍受保护。不同浏览器连接互不切换；不是账号权限边界。30个MCP工具，25项测试通过，线上演示项目选稿→远程MCP上下文验证通过，未改内容并已取消测试选择。

## 原生 PPTX 草稿运行环境

工作台仅对已审核的 Steam 原始 PPTX SHA-256 开放原生生成。上传模板时保留原始 PPTX；生成时需同月、同快照的消费数据 JSON 与时间窗口审计 JSON。后台调用 Python 标准库脚本，输出可编辑 PPTX 和独立缺失清单；研究文字、图片与历史评测缺口仍需人工处理。Docker 镜像在 Node 24 Alpine 上安装 python3，部署脚本先构建并验证镜像，再备份、切换和重启本项目容器，不改其他项目。线上发布后应以真实 8 月样本检查下载与 PowerPoint 打开情况。
