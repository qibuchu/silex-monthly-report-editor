/** RFC 4122 UUIDs on internal HTTP sites, using Web Crypto (never Math.random). */
export function installRandomUuid(api: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }) {
  if (api.randomUUID) return
  Object.defineProperty(api, 'randomUUID', { configurable: true, value: () => {
    const bytes = api.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 15) | 64
    bytes[8] = (bytes[8] & 63) | 128
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  } })
}
installRandomUuid(globalThis.crypto)
