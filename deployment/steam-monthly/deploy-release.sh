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

mkdir "$target"
tar -xzf "$archive" -C "$target"
for rel in pipeline/monthly-service/package-lock.json work/silex-poc/pnpm-lock.yaml; do
  cmp -s "current/$rel" "$target/$rel" || { echo "依赖锁文件变化，需先按锁文件准备新版本依赖：$rel" >&2; exit 3; }
done
for rel in pipeline/monthly-service/node_modules work/silex-poc/node_modules; do
  [[ -d "current/$rel" ]] || { echo "当前版本缺少依赖：$rel" >&2; exit 3; }
  cp -a "current/$rel" "$target/$rel"
done

# A recoverable project backup precedes every code switch; state is never copied over.
sudo docker exec steam-monthly-app node -e 'import("/app/pipeline/monthly-service/maintenance.mjs").then(m=>console.log(m.backupStore("/state/data","/state/backups")))'
sudo docker compose -p steam-monthly -f compose.yaml stop app
# The container was stopped before the new process starts; its PID lock is now stale.
sudo rm -f -- state/data/.service-lock.json
ln -sfn "releases/$release_id" current-next
mv -Tf current-next current
if ! sudo docker compose -p steam-monthly -f compose.yaml up -d --force-recreate app; then
  sudo docker compose -p steam-monthly -f compose.yaml stop app || true
  sudo rm -f -- state/data/.service-lock.json
  ln -sfn "$previous" current-next; mv -Tf current-next current
  sudo docker compose -p steam-monthly -f compose.yaml up -d --force-recreate app
  echo '新版本启动失败，已回滚' >&2; exit 1
fi
healthy=false
for _ in $(seq 1 24); do
  if [[ $(sudo docker inspect -f '{{.State.Health.Status}}' steam-monthly-app 2>/dev/null || true) == healthy ]]; then healthy=true; break; fi
  sleep 5
done
if [[ $healthy != true ]]; then
  sudo docker compose -p steam-monthly -f compose.yaml stop app
  sudo rm -f -- state/data/.service-lock.json
  ln -sfn "$previous" current-next; mv -Tf current-next current
  sudo docker compose -p steam-monthly -f compose.yaml up -d --force-recreate app
  echo '健康检查未通过，已回滚' >&2; exit 1
fi
sudo docker run --rm -v "$base:/srv" node:24-alpine \
  node /srv/current/deployment/steam-monthly/prune-releases.mjs /srv "$previous"
echo "发布完成：$release_id；回滚版本：$previous"
