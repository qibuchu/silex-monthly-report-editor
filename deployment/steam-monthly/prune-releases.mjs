import fs from 'node:fs';
import path from 'node:path';

export function pruneReleases(base, previous, currentOverride = null) {
  const root = fs.realpathSync(base);
  const releases = fs.realpathSync(path.join(root, 'releases'));
  if (path.dirname(releases) !== root) throw Error('发布目录不在服务根目录内');
  const current = currentOverride || fs.readlinkSync(path.join(root, 'current'));
  const valid = value => /^releases\/20\d{6}-\d{2}$/.test(value);
  if (!valid(current) || !valid(previous)) throw Error('当前或回滚版本路径不符合发布目录规则');
  const keep = new Set([path.basename(current), path.basename(previous)]);
  if (![...keep].every(name => fs.existsSync(path.join(releases, name)))) throw Error('回滚目录不存在');
  const removed = [];
  for (const entry of fs.readdirSync(releases, {withFileTypes:true})) {
    if (entry.isDirectory() && /^20\d{6}-\d{2}$/.test(entry.name) && !keep.has(entry.name)) {
      const candidate = path.join(releases, entry.name);
      if (fs.realpathSync(candidate) !== candidate || path.dirname(candidate) !== releases) throw Error('发布目录路径异常');
      fs.rmSync(candidate, {recursive:true,force:false});removed.push(entry.name);
    }
    if (entry.isFile() && /^server-20\d{6}-\d{2}\.tar\.gz$/.test(entry.name)) {
      fs.unlinkSync(path.join(releases, entry.name));removed.push(entry.name);
    }
  }
  return removed;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) {
  const [base, previous] = process.argv.slice(2);
  if (!base || !previous) throw Error('用法：node prune-releases.mjs 服务根目录 上一个发布相对路径');
  console.log(JSON.stringify({removed:pruneReleases(base,previous)}));
}
