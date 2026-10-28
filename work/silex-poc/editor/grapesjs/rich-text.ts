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

import { RichTextEditorAction } from 'grapesjs'

const pluginName = 'richText'

export const orderedList: RichTextEditorAction = {
  name: 'orderedList',
  icon: '1.',
  attributes: { title: '有序列表' },
  result: rte => rte.exec('insertOrderedList'),
}

export const unorderedList: RichTextEditorAction = {
  name: 'unorderedList',
  icon: '•',
  //icon: '<i class="fa fa-list-ul"></i>',
  attributes: { title: '无序列表' },
  result: rte => rte.exec('insertUnorderedList'),
}

export const richTextPlugin = (editor, opts) => {
  const titles = { Bold: '加粗', Italic: '斜体', Underline: '下划线', 'Strike-through': '删除线', Link: '链接', 'Wrap for style': '包裹文字以设置样式', 'Ordered List': '有序列表', 'Unordered List': '无序列表' }
  editor.on('rte:enable', () => {
    if (editor.I18n.getLocale() !== 'zh') return
    for (const element of editor.RichTextEditor.getToolbarEl().querySelectorAll('[title]')) {
      const title = element.getAttribute('title')
      if (titles[title]) element.setAttribute('title', titles[title])
    }
  })
  // This doesn't work, it is now added in the editor config
  //editor.RichTextEditor.add('orderedList', orderedList)
  //editor.RichTextEditor.add('unorderedList', unorderedList)
}
