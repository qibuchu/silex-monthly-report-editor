/** Retry reads only: a lost write response must never cause a duplicate save. */
export async function fetchWithConnectionError(url: string, init: RequestInit, label: string) {
  const method = (init.method || 'GET').toUpperCase(), attempts = method === 'GET' ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await fetch(url, init) } catch (cause) {
      if (attempt + 1 < attempts) { await new Promise(resolve => setTimeout(resolve, 250)); continue }
      console.error(`${label}请求失败`, { method, url, cause })
      throw new Error(`无法连接${label}（${method} ${url}）。请保留当前页面，服务恢复后重试；不要刷新尚有未保存修改的页面。`, { cause })
    }
  }
  throw new Error(`无法连接${label}`)
}
