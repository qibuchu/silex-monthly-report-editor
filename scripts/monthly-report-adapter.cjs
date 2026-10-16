#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const DEFAULT_STORAGE_ROOT = path.join(__dirname, '..', 'silex', 'storage')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n')
}

function unwrapProject(input) {
  const project = input?.project || input
  if (project?.format !== 'steam-grapesjs-v2' || !Array.isArray(project?.deck?.pages)) {
    throw new Error('输入必须是 steam-grapesjs-v2 可编辑月报项目或共享项目 envelope')
  }
  return project
}

function safeId(value, fallback) {
  const result = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return result || fallback
}

function pageSlug(name, index) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return slug || (index === 0 ? 'index' : `slide-${index + 1}`)
}

function normalizeObjectStyle(style = {}) {
  return {
    ...style,
    position: 'absolute',
    'box-sizing': 'border-box',
  }
}

function objectComponent(object, pageIndex, objectIndex) {
  const originalId = object?.attributes?.['data-object-id']
  const id = safeId(originalId, `slide-${pageIndex + 1}-object-${objectIndex + 1}`)
  const attributes = {
    ...(object.attributes || {}),
    id,
    'data-object-id': id,
    'data-binding-id': object.attributes?.['data-binding-id'] || id,
    'data-report-object': 'true',
  }

  return {
    attributes,
    tagName: object.tagName || 'div',
    classes: [...new Set(['object', `report-${attributes['data-kind'] || 'object'}`, ...(object.classes || [])])],
    components: object.content || '',
    name: attributes['data-name'] || id,
    type: 'default',
  }
}

function pageData(page, pageIndex) {
  const id = `monthly-slide-${String(pageIndex + 1).padStart(2, '0')}`
  const rootId = `${id}-root`
  const canvasId = `${id}-canvas`
  return {
    id,
    name: page.name || `第 ${pageIndex + 1} 页`,
    frames: [
      {
        width: Number(page.width) || 1920,
        height: Number(page.height) || 1080,
        component: {
          COMPONENT_NAME_PREFIX: '',
          attributes: { id: rootId },
          components: [
            {
              attributes: {
                id: canvasId,
                'data-report-page': String(pageIndex + 1),
                'data-report-page-name': page.name || `第 ${pageIndex + 1} 页`,
              },
              classes: ['slide', 'monthly-report-slide'],
              components: page.objects.map((object, objectIndex) => objectComponent(object, pageIndex, objectIndex)),
              name: page.name || `第 ${pageIndex + 1} 页`,
            },
          ],
        },
      },
    ],
  }
}

function baseStyles(project) {
  const styles = [
    {
      selectors: ['monthly-report-slide'],
      style: {
        background: '#ffffff',
        height: '1080px',
        overflow: 'hidden',
        position: 'relative',
        width: '1920px',
      },
    },
    {
      selectors: ['object'],
      style: { 'box-sizing': 'border-box', position: 'absolute' },
    },
    {
      selectors: ['text'],
      style: { 'box-sizing': 'border-box' },
    },
    {
      selectors: ['rich'],
      style: { outline: 'none', width: '100%' },
    },
    {
      selectors: ['imagebox'],
      style: { inset: '0', overflow: 'hidden', position: 'absolute' },
    },
    {
      selectors: ['chart'],
      style: { inset: '0', position: 'absolute' },
    },
    {
      selectors: ['native-table'],
      style: { 'border-collapse': 'collapse', 'table-layout': 'fixed', width: '100%' },
    },
  ]

  project.deck.pages.forEach((page, pageIndex) => {
    styles.push({
      selectors: [`#monthly-slide-${String(pageIndex + 1).padStart(2, '0')}-canvas`],
      style: { background: page.background || '#ffffff', width: `${Number(page.width)||1920}px`, height: `${Number(page.height)||1080}px` },
    })
    page.objects.forEach((object, objectIndex) => {
      const id = safeId(object?.attributes?.['data-object-id'], `slide-${pageIndex + 1}-object-${objectIndex + 1}`)
      styles.push({ selectors: [`#${id}`], style: normalizeObjectStyle(object.style) })
    })
  })
  return styles
}

function createSilexProject(input) {
  const project = unwrapProject(input)
  const pages = project.deck.pages.map(pageData)
  const reportMonth = project.deck.notes?.report_month || 'unknown-month'
  const website = {
    assets: [],
    cssVarOrder: [],
    dataSources: [],
    fonts: [],
    pages: pages.map((page, index) => ({
      id: page.id,
      isFile: true,
      name: page.name,
      slug: pageSlug(page.name, index),
    })),
    pagesFolder: 'pages',
    publication: {},
    settings: {
      lang: 'zh-CN',
      title: `Steam ${reportMonth} 月报`,
    },
    styles: baseStyles(project),
    symbols: [],
  }
  return {
    meta: {
      connectorUserSettings: {},
      name: `Steam ${reportMonth} 月报（Silex）`,
    },
    pages,
    website,
  }
}

function writeSilexProject(result, storageRoot, projectId, force = false) {
  const outputDir = path.resolve(storageRoot, projectId)
  if (fs.existsSync(outputDir) && !force) {
    throw new Error(`目标项目已存在：${outputDir}。如需覆盖请传入 --force`)
  }
  if (fs.existsSync(outputDir) && force) {
    fs.rmSync(outputDir, { force: true, recursive: true })
  }
  fs.mkdirSync(path.join(outputDir, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(outputDir, 'assets'), { recursive: true })
  writeJson(path.join(outputDir, 'meta.json'), result.meta)
  writeJson(path.join(outputDir, 'website.json'), result.website)
  result.pages.forEach((page, index) => {
    const slug = result.website.pages[index].slug
    writeJson(path.join(outputDir, 'pages', `${slug}-${page.id}.json`), page)
  })
  return outputDir
}

function main(argv) {
  const args = argv.filter(arg => arg !== '--force')
  const force = argv.includes('--force')
  const [inputPath, storageRoot = DEFAULT_STORAGE_ROOT, projectIdArg] = args
  if (!inputPath) {
    throw new Error('用法：node scripts/monthly-report-adapter.cjs <可编辑月报.json> [Silex存储目录] [项目ID] [--force]')
  }
  const input = readJson(path.resolve(inputPath))
  const project = unwrapProject(input)
  const month = project.deck.notes?.report_month || 'unknown-month'
  const projectId = safeId(projectIdArg, `steam-monthly-${month}`)
  const result = createSilexProject(input)
  const outputDir = writeSilexProject(result, storageRoot, projectId, force)
  const objectCount = project.deck.pages.reduce((sum, page) => sum + page.objects.length, 0)
  console.log(JSON.stringify({
    objectCount,
    outputDir,
    pageCount: result.pages.length,
    projectId,
    url: `http://localhost:6805/?id=${encodeURIComponent(projectId)}&connectorId=fs-storage&lang=zh`,
  }, null, 2))
}

module.exports = {
  createSilexProject,
  pageSlug,
  safeId,
  unwrapProject,
  writeSilexProject,
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
