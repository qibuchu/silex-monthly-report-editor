import type { Component, Editor, Page } from 'grapesjs'
import { buildAiRequest, businessName, stableObjectId, validateAiPatch } from './monthly-workspace'

function fakeComponent(options: { id: string, name?: string, kind?: string, text?: string, parent?: Component } ) {
  const attributes = { id: options.id, 'data-binding-id': options.id, ...(options.kind ? { 'data-kind': options.kind } : {}) }
  return {
    getAttributes: () => attributes,
    getId: () => options.id,
    get: (key: string) => key === 'name' ? options.name || '' : key === 'tagName' ? 'div' : 'default',
    getClasses: () => [],
    getStyle: () => ({ left: '10px', top: '20px', color: '#00366b', '--ignored': 'value' }),
    getEl: () => ({ textContent: options.text || '', outerHTML: `<div id="${options.id}">${options.text || ''}</div>` }),
    toHTML: () => `<div>${options.text || ''}</div>`,
    parent: () => options.parent,
    components: () => ({ models: [] }),
  } as unknown as Component
}

describe('monthly workspace AI boundary', () => {
  it('uses stable business IDs and names', () => {
    const component = fakeComponent({ id: 'revenue-card', name: '营收指标卡', kind: 'card' })
    expect(stableObjectId(component)).toBe('revenue-card')
    expect(businessName(component)).toBe('营收指标卡')
  })

  it('generates a structured request with page and style context', () => {
    const root = fakeComponent({ id: 'page-root', name: '八月月报' })
    const component = fakeComponent({ id: 'headline', name: '主标题', kind: 'text', text: '8月新品概况', parent: root })
    const page = { id: 'page-4', getName: () => '4 · 大盘总览', getMainComponent: () => root } as unknown as Page
    const editor = { Pages: { getAll: () => [page], getSelected: () => page } } as unknown as Editor
    const request = buildAiRequest(editor, [component], '改为九月标题')
    expect(request.schema).toBe('monthly-editor-ai-request/v1')
    expect(request.page.id).toBe('page-4')
    expect(request.objects[0]).toMatchObject({ id: 'headline', bindingId: 'headline', type: 'text', name: '主标题', parentId: 'page-root' })
    expect(request.objects[0].style).toEqual({ left: '10px', top: '20px', color: '#00366b' })
    expect(request.constraints.modifyOnlyObjectIds).toEqual(['headline'])
  })

  it('rejects patches that target unmarked objects', () => {
    expect(() => validateAiPatch({ objects: [{ id: 'not-marked', text: '覆盖' }] }, new Set(['headline']))).toThrow('未被标记')
    expect(validateAiPatch({ objects: [{ id: 'headline', text: '允许修改' }] }, new Set(['headline'])).objects).toHaveLength(1)
  })
})
