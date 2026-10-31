#!/usr/bin/env bash
set -euo pipefail

# Run on the monthly server after uploading a package built from a committed source revision.
base=/data/home/buchutang/services/steam-monthly
release_id=${1:-}
if [[ ! $release_id =~ ^20[0-9]{6}-[0-9]{2}$ ]]; then
  echo '用法：deploy-release.sh YYYYMMDD-NN' >&2; exit 2
fi
cd "$base"
archive="$base/releases/server-$release_id.tar.gz"
target="$base/releases/$release_id"
[[ -f $archive && ! -e $target ]] || { echo '发布包不存在或目标版本已存在' >&2; exit 2; }
previous=$(readlink current)
[[ $previous =~ ^releases/20[0-9]{6}-[0-9]{2}$ ]] || { echo '当前版本路径异常' >&2; exit 2; }
cmp -s compose.yaml current/deployment/steam-monthly/compose.yaml || { echo '服务器Compose与当前发布源码不同，停止自动替换' >&2; exit 3; }

mkdir "$target"
tar -xzf "$archive" -C "$target"
for rel in pipeline/monthly-service/package-lock.json work/silex-poc/pnpm-lock.yaml; do
  cmp -s "current/$rel" "$target/$rel" || { echo "依赖锁文件变化，需先按锁文件准备新版本依赖：$rel" >&2; exit 3; }
done
for rel in pipeline/monthly-service/node_modules work/silex-poc/node_modules; do
  [[ -d "current/$rel" ]] || { echo "当前版本缺少依赖：$rel" >&2; exit 3; }
  cp -a "current/$rel" "$target/$rel"
done

# Build the isolated runtime before stopping the live service. Native PPTX
# generation uses Python's standard library; no Python package is installed.
sudo docker build --pull=false -t steam-monthly-runtime:python3 "$target/deployment/steam-monthly"
sudo docker run --rm steam-monthly-runtime:python3 python3 --version

# A recoverable project backup precedes every code switch; state is never copied over.
sudo docker exec steam-monthly-app node -e 'import("/app/pipeline/monthly-service/maintenance.mjs").then(m=>console.log(m.backupStore("/state/data","/state/backups")))'
compose_backup="$base/compose.yaml.rollback-$release_id"
cp compose.yaml "$compose_backup"
rollback_required=true
rollback(){
  if [[ $rollback_required != true ]]; then return; fi
  trap - ERR
  sudo docker compose -p steam-monthly -f compose.yaml stop app || true
  sudo rm -f -- state/data/.service-lock.json
  cp "$compose_backup" compose.yaml
  ln -sfn "$previous" current-next; mv -Tf current-next current
  sudo docker compose -p steam-monthly -f compose.yaml up -d --force-recreate app
  echo '新版本启动或健康检查失败，已回滚' >&2
}
trap rollback ERR
sudo docker compose -p steam-monthly -f compose.yaml stop app
# The container was stopped before the new process starts; its PID lock is now stale.
sudo rm -f -- state/data/.service-lock.json
cp "$target/deployment/steam-monthly/compose.yaml" compose.yaml
ln -sfn "releases/$release_id" current-next
mv -Tf current-next current
if ! sudo docker compose -p steam-monthly -f compose.yaml up -d --force-recreate app; then
  rollback; exit 1
fi
healthy=false
for _ in $(seq 1 24); do
  if [[ $(sudo docker inspect -f '{{.State.Health.Status}}' steam-monthly-app 2>/dev/null || true) == healthy ]]; then healthy=true; break; fi
  sleep 5
done
if [[ $healthy != true ]]; then
  rollback; exit 1
fi
rollback_required=false
trap - ERR
rm -f -- "$compose_backup"
sudo docker exec steam-monthly-app node -e 'import("/app/pipeline/monthly-service/maintenance.mjs").then(m=>console.log(JSON.stringify({prunedBackups:m.pruneBackups("/state/backups",7)})))'
sudo docker run --rm -v "$base:/srv" node:24-alpine \
  node /srv/current/deployment/steam-monthly/prune-releases.mjs /srv "$previous"
echo "发布完成：$release_id；回滚版本：$previous"
