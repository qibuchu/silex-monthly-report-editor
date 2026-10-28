const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createSilexProject, pageSlug, writeSilexProject } = require('./monthly-report-adapter.cjs')

function fixture() {
  return {
    format: 'steam-grapesjs-v2',
    current: 0,
    deck: {
      css: '',
      notes: { report_month: '2026-08' },
      pages: [
        {
          name: '1 · 封面',
          background: 'rgb(255, 255, 255)',
          objects: [
            {
              type: 'report-object',
              attributes: {
                'data-kind': 'text',
                'data-name': '标题',
                'data-object-id': 's1o2',
              },
              style: { height: '80px', left: '100px', top: '120px', width: '600px' },
              content: '<div class="text"><div class="rich">Steam月报</div></div>',
            },
          ],
        },
      ],
    },
  }
}

test('converts report pages and preserves stable object ids', () => {
  const result = createSilexProject(fixture())
  assert.equal(result.pages.length, 1)
  assert.equal(result.website.pages.length, 1)
  const component = result.pages[0].frames[0].component.components[0].components[0]
  assert.equal(component.attributes.id, 's1o2')
  assert.equal(component.attributes['data-binding-id'], 's1o2')
  assert.match(component.components, /Steam月报/)
  const style = result.website.styles.find(rule => rule.selectors.includes('#s1o2'))
  assert.equal(style.style.left, '100px')
  assert.equal(style.style.position, 'absolute')
})

test('uses the same page slug algorithm as Silex serialization', () => {
  assert.equal(pageSlug('1 · 封面', 0), '1-')
  assert.equal(pageSlug('New Page', 1), 'new-page')
})

test('preserves semantic data bindings for editable template slots', () => {
  const source = fixture()
  source.deck.pages[0].objects[0].attributes['data-binding-id'] = 'report.title'
  const result = createSilexProject(source)
  assert.equal(result.pages[0].frames[0].component.components[0].components[0].attributes['data-binding-id'], 'report.title')
})

test('writes split Silex website files and refuses accidental overwrite', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silex-monthly-adapter-'))
  const result = createSilexProject(fixture())
  const output = writeSilexProject(result, tempRoot, 'monthly-test')
  assert.ok(fs.existsSync(path.join(output, 'meta.json')))
  assert.ok(fs.existsSync(path.join(output, 'website.json')))
  assert.equal(fs.readdirSync(path.join(output, 'pages')).length, 1)
  assert.throws(() => writeSilexProject(result, tempRoot, 'monthly-test'), /已存在/)
})
