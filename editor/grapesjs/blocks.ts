/*
 * Silex website builder, free/libre no-code tool for makers.
 * Copyright (c) 2023 lexoyo and Silex Labs foundation
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Default styles for blocks, applied via CSS classes instead of inline styles.
 * This prevents GrapesJS from adding auto-generated IDs to published HTML
 * (GrapesJS adds IDs to components with inline styles for #id CSS selectors).
 */
const BLOCK_DEFAULT_STYLES: Record<string, Record<string, string>> = {
  'container': { 'min-height': '100px' },
  'text': { 'padding': '10px' },
}

const MONTHLY_BLOCK_STYLES: Record<string, Record<string, string>> = {
  '.monthly-section-title': { color: '#00366b', 'font-size': '30px', 'font-weight': '700', padding: '12px 18px', background: '#fff', 'border-left': '4px solid #d0a044', 'box-shadow': '0 8px 18px rgba(0, 37, 74, .08)' },
  '.monthly-kpi-card': { width: '240px', padding: '18px', color: '#fff', background: '#00366b', 'border-radius': '18px', 'text-align': 'center' },
  '.monthly-kpi-label': { 'font-size': '16px' },
  '.monthly-kpi-value': { color: '#d0a044', 'font-size': '42px', 'font-weight': '700', 'line-height': '1.15' },
  '.monthly-opinion-box': { padding: '28px', color: '#00366b', background: '#fff', border: '1px solid #e3e6ea', 'border-radius': '24px', 'box-shadow': '0 5px 14px rgba(0, 37, 74, .10)', 'font-size': '18px', 'line-height': '1.65' },
  '.monthly-game-card': { display: 'grid', 'grid-template-columns': '96px 1fr', gap: '16px', padding: '14px', color: '#00366b', background: '#fff', 'border-radius': '10px' },
  '.monthly-game-cover': { width: '96px', height: '96px', background: '#dfe5ec', 'object-fit': 'cover' },
  '.monthly-game-name': { margin: '0 0 8px', 'font-size': '20px', 'font-weight': '700' },
  '.monthly-game-copy': { margin: '0', 'font-size': '15px', 'line-height': '1.55' },
  '.monthly-image-text': { display: 'grid', 'grid-template-columns': '42% 1fr', gap: '22px', padding: '14px', color: '#00366b' },
  '.monthly-image-placeholder': { display: 'grid', 'min-height': '180px', color: '#7b8794', background: '#e8edf2', 'place-items': 'center' },
}

function defaultClassName(blockType: string): string {
  if (blockType in BLOCK_DEFAULT_STYLES) return `silex-default-${blockType}`
  return ''
}

export const blocksPlugin = (editor, opts) => {
  // Defaults
  const options = {
    ...opts,
  }

  // Container block — use class instead of inline style
  const containerId = 'container'
  editor.BlockManager.add(containerId, {
    label: '容器',
    category: '基础',
    attributes: { class: 'container-png' },
    content: {
      type: containerId,
      classes: [defaultClassName(containerId)],
    },
  })
  editor.DomComponents.addType(containerId, {})

  const monthlyBlocks = [{
    id: 'monthly-section-title',
    label: '章节标题',
    content: '<div class="monthly-section-title" data-monthly-component="section-title">章节标题</div>',
  }, {
    id: 'monthly-kpi-card',
    label: '指标卡',
    content: '<div class="monthly-kpi-card" data-monthly-component="kpi-card"><div class="monthly-kpi-label">指标名称</div><div class="monthly-kpi-value">—</div><div>补充说明</div></div>',
  }, {
    id: 'monthly-opinion-box',
    label: '观点框',
    content: '<div class="monthly-opinion-box" data-monthly-component="opinion-box">• 在这里填写观点总结</div>',
  }, {
    id: 'monthly-game-card',
    label: '游戏卡片',
    content: '<div class="monthly-game-card" data-monthly-component="game-card"><div class="monthly-game-cover">封面</div><div><h3 class="monthly-game-name">游戏名称</h3><p class="monthly-game-copy">在这里填写游戏介绍或具体做法。</p></div></div>',
  }, {
    id: 'monthly-image-text',
    label: '左图右文',
    content: '<div class="monthly-image-text" data-monthly-component="image-text"><div class="monthly-image-placeholder">插入图片</div><div><h3 class="monthly-game-name">小标题</h3><p class="monthly-game-copy">在这里填写正文内容。</p></div></div>',
  }]
  monthlyBlocks.forEach(block => editor.BlockManager.add(block.id, {
    label: block.label,
    category: '月报组件',
    content: block.content,
  }))

  // Override grapesjs-blocks-basic blocks to use classes instead of inline styles
  const blocksToFix = ['text', 'link', 'image', 'video', 'map']
  blocksToFix.forEach(blockId => {
    const block = editor.BlockManager.get(blockId)
    if (block) {
      const content = block.get('content')
      if (content && typeof content === 'object' && content.style) {
        delete content.style
        const cls = defaultClassName(blockId)
        if (cls) content.classes = [...(content.classes || []), cls]
        block.set('content', { ...content })
      }
    }
  })

  editor.on('canvas:frame:load', () => {
    Object.entries(BLOCK_DEFAULT_STYLES).forEach(([blockType, styles]) => {
      const selector = `.${defaultClassName(blockType)}`
      if (!editor.Css.getRule(selector)) {
        editor.Css.setRule(selector, styles)
      }
    })
    Object.entries(MONTHLY_BLOCK_STYLES).forEach(([selector, styles]) => {
      if (!editor.Css.getRule(selector)) editor.Css.setRule(selector, styles)
    })
  })
}
