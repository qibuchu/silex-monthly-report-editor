# 月报工作台

本仓库包含月报项目服务、草稿生成器、PPT 模板处理、Silex 可视化编辑器和独立部署脚本。运行中的项目、上传图片、备份、令牌及本机配置不在 Git 仓库中。

## 目录

- `pipeline/monthly-service/`：工作台、MCP、项目与模板服务。
- `pipeline/monthly-toolkit/`、`workflow/`：月报草稿生成和数据契约。
- `work/silex-poc/`：Silex 编辑器及月报扩展。
- `deployment/steam-monthly/`：服务器运行配置和部署维护脚本。
- `tools/`：构建、测试和发布包生成。

## 本地构建

需要 Node.js 24+、pnpm 10.34.4。首次运行 `node tools/prepare-demo.cjs --install --build`，然后运行 `node tools/start-demo.cjs`。详细流程见 [部署说明](pipeline/monthly-service/DEPLOY.md)。

## 服务器发布

源码以 Git 为准。先在干净检出的仓库构建并测试，再执行 `node tools/package-server.cjs releases/<新版本>` 生成不含状态数据和凭据的发布包。服务器只保留当前及上一个可回滚发布目录；`state/`、`runtime/`、`secrets/` 独立于发布目录。发布与回滚使用 `deployment/steam-monthly/deploy-release.sh`，发布成功且健康检查通过后才执行发布目录清理。备份另行管理，不参与代码发布目录清理。

历史月报必须匹配统计时间窗口；缺失数据留空并单独记录。不得用当前快照替代历史评测、好评率和月末状态。
