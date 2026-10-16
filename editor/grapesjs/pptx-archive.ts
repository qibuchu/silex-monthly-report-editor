import { unzip, unzipSync } from 'fflate'

export function checkPptxArchive(bytes: Uint8Array) {
  let total = 0, count = 0
  // fflate reads the ZIP directory and invokes filter before allocating or
  // inflating entries. This pass intentionally extracts nothing.
  unzipSync(bytes, { filter: entry => {
    if (++count > 10000) throw new Error('PPTX 文件条目超过10000项，请拆分文件。')
    total += entry.originalSize
    if (!Number.isSafeInteger(total) || total > 250 * 1024 * 1024) throw new Error('解压后超过250MB，请压缩图片或拆分文件。')
    return false
  } })
}

export async function unzipPptx(bytes: Uint8Array) {
  checkPptxArchive(bytes)
  const archive = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, files) => error ? reject(error) : resolve(files))
  })
  if (Object.values(archive).reduce((total, entry) => total + entry.length, 0) > 250 * 1024 * 1024) throw new Error('解压后超过250MB，请拆分文件。')
  return archive
}
