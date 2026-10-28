# 安装、发布与恢复

## 新电脑准备

需要Node.js 24+与pnpm 10.34.4。完整源码目录含pipeline、tools、workflow及work/silex-poc，不能仅复制编辑器HTML。首次在根目录执行：

```
node tools/prepare-demo.cjs --install --build
node tools/start-demo.cjs
```

首次安装需要访问依赖仓库；内网部署可在可联网的同平台构建机完成依赖安装与构建后部署。生成器会在准备阶段从源码打包，禁止运行旧build-fidelity。已有环境执行`node tools/prepare-demo.cjs`即可检查依赖、产物和脚本同步状态。

工作台为http://127.0.0.1:4320/，原生编辑器为6805。启动器验证服务身份与版本，端口被其他程序或旧服务占用会明确报错；本次启动的子进程异常退出最多恢复3次。生成任务中断后须重新提交，不会自动以旧数据补生成。

完整工作台源码保存在统一 Git 仓库；`work/silex-poc` 是编辑器子目录，`pipeline`、`workflow`、`tools` 和 `deployment` 同属该仓库。`node tools/package-demo.cjs releases/月报工具-新版本号` 仅生成离线源码交付包，不作为日常版本历史。包附 SHA256 清单，排除用户项目、登录凭据、node_modules、构建产物与备份；运行数据不得提交 Git。

## 两种取数方式

推荐保持本地AI取数：运营人员在本地智能体配置SteamAuto skill，按目标月份取标准JSON，通过MCP桥接器dataFile或网页上传生成。网站显示“未配置服务端取数”在这种模式下是正常配置状态，不表示本地AI流程缺功能。

如需要网站自行取数，将pipeline/monthly-toolkit/config.example.json复制为私有配置，填入本机Python和steamautoSkillDir，然后在服务config.json设置generationConfig为此配置的路径。路径相对各自配置文件解析；Python模块与skill依赖须独立安装。凭据只在运行环境保存，不随发布包分发。服务不会自行猜测用户的账号、凭据或Python位置。

在线取数先执行凭据检查；401/403或过期时任务进入awaiting_credentials，不发布草稿、不自动重试。用户续期并明确确认后重新提交任务。数据包也必须匹配目标月及D0至D13窗口，不允许替换为当前评测快照。

## 备份与恢复

工作台“备份全部项目”或鉴权POST /api/backup创建服务器本地备份。默认服务连续运行每24小时备份一次，配置backupIntervalHours可修改（0关闭，最大500）。backupDir默认在dataDir相邻的backups目录，不能设在dataDir内部。备份不自动清理；应根据磁盘容量将备份复制到独立磁盘或团队备份系统。

备份包含store.json、历史、图片和冲突副本，清单记录每个文件长度与SHA256。未发布的临时生成输出不属于项目备份。依赖、配置和取数凭据需另行安全保管。

恢复到一个不存在的新目录，不能覆盖现用库：

```
node pipeline/monthly-service/maintenance.mjs restore --backup 备份绝对目录 --data-dir 新数据绝对目录
```

恢复先验证清单与校验和，再写临时目录并原子重命名。先使用另一个本机端口检查项目和图片；恢复同一地址时资源URL不变，更换publicUrl需额外迁移资源引用或逐项目使用可编辑JSON归档导入。确认恢复结果后，停止原服务并将config.json的dataDir切换到新目录。运行服务对dataDir加单实例锁，避免两个进程覆盖同一个JSON库；不能用多副本服务同时挂载该目录。

## 内网或服务器部署

从云端仓库的干净检出构建，先运行 `node tools/prepare-demo.cjs --install --build` 和服务、编辑器测试，再运行 `node tools/package-server.cjs releases/server-YYYYMMDD-NN`。`server-manifest.json` 记录构建来源 Git revision。将该目录压缩为 `server-YYYYMMDD-NN.tar.gz`，上传到服务器 `/data/home/buchutang/services/steam-monthly/releases/`，在服务器执行 `bash current/deployment/steam-monthly/deploy-release.sh YYYYMMDD-NN`。脚本检查锁文件、复用已安装依赖、备份项目数据、原子切换 `current`、只重建本项目容器，健康检查失败自动回滚。成功后只留当前与上一发布目录，移除旧发布目录和上传的压缩包；不碰 `state`、`runtime`、`secrets` 或其他 Docker 项目。若依赖锁文件变化，先在新版本目录独立安装锁定依赖，不能复用旧依赖；脚本会在切换前停止并提示。

部署包仍需保留一份正在运行的代码，云端 Git 历史负责长期保存源码；服务器本地仅保留一个回滚版本。自动项目备份不随代码版本清理，需另设异地备份与保留策略。禁止用 `docker system prune` 清理同机其他项目。

服务器分别运行4320项目服务与6805编辑器。项目服务监听非本机地址时必须设置REPORT_SERVICE_TOKEN环境变量，不能把令牌写入发布包或网页URL。publicUrl与silexUrl须为用户浏览器能访问的地址，不能继续填写服务器自身的127.0.0.1。

两个网页建议使用同一站点下的HTTPS域名，以便HttpOnly、SameSite=Strict会话可用于编辑器请求。当前带令牌的本机跳转会统一localhost与127.0.0.1主机名，避免跨站Cookie失效。不同站点域名需额外认证设计，不通过关闭浏览器安全策略解决。

项目服务的共享令牌适合受控小团队试用；当前没有内建个人账号或项目级权限。正式多人部署须由网关统一保护项目服务和Silex，包括Silex原有API与存储路由，不能只保护4320而裸露6805。本轮没有替团队部署网关或创建账号。反向代理、证书、身份系统及外部MCP客户端需要在目标环境验收。

## 操作与验收

先运行服务测试、编辑器测试、lint与构建；再使用独立测试项目验收“生成→人工编辑→聊天修改→刷新→导出→重导入”。代码检查不代表数字正确，也不代替逐页视觉核验。普通HTML负责展示，可编辑JSON负责恢复编辑；当前不提供导回PPTX。

完整日志位于work/demo-logs，服务存储位于配置的dataDir。遇到保存失败先保留页面及本地未保存内容，不要直接刷新；409按对象ID合并，不提高版本号强行覆盖。
