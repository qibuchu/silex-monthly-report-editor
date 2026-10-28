import { installRandomUuid } from './browser-compat'
it('uses cryptographic bytes and correct UUID version/variant when HTTP lacks randomUUID', () => {
  let calls = 0
  const api = { getRandomValues: (bytes: Uint8Array) => { calls++; return bytes.fill(255) } } as any
  installRandomUuid(api)
  expect(api.randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  expect(calls).toBe(1)
})
it('preserves the native implementation when available', () => {
  const native = () => 'native'
  const api = { randomUUID: native, getRandomValues: () => { throw Error('unexpected fallback') } } as any
  installRandomUuid(api)
  expect(api.randomUUID).toBe(native)
})
