import { jest } from '@jest/globals'
import { fetchWithConnectionError } from './network-request'
describe('network request recovery', () => {
  const original = globalThis.fetch
  afterEach(() => { globalThis.fetch = original; jest.restoreAllMocks() })
  it('retries a transient failed read', async () => {
    const mock = jest.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true } as Response)
    globalThis.fetch = mock
    expect((await fetchWithConnectionError('http://localhost:4320/status', {}, '月报服务')).ok).toBe(true)
    expect(mock).toHaveBeenCalledTimes(2)
  })
  it('does not replay writes and identifies the failing service', async () => {
    const mock = jest.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    globalThis.fetch = mock; jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(fetchWithConnectionError('http://localhost:4320/project', { method: 'PUT' }, '月报服务')).rejects.toThrow('PUT http://localhost:4320/project')
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('leaves conflict responses to the normal version checks', async () => {
    const mock = jest.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 409 } as Response)
    globalThis.fetch = mock
    expect((await fetchWithConnectionError('http://localhost:4320/project', { method: 'PUT' }, '月报服务')).status).toBe(409)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
