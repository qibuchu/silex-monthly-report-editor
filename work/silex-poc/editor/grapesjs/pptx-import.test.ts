import { parsePptxArchive } from './pptx-import'
import { TextDecoder, TextEncoder } from 'node:util'

Object.assign(globalThis, { TextDecoder, TextEncoder })
const strToU8 = (value: string) => new TextEncoder().encode(value)

const files = Object.fromEntries(Object.entries({
  'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:a="a" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  'ppt/_rels/presentation.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
  'ppt/slides/slide1.xml': `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="685800"/></a:xfrm><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="003366"/></a:solidFill></a:rPr><a:t>月报标题</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="3" name="封面图"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1219200" cy="685800"/></a:xfrm></p:spPr></p:pic>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="图表"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="1371600"/><a:ext cx="6096000" cy="3429000"/></p:xfrm></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Target="../media/image1.png"/></Relationships>',
  'ppt/media/image1.png': 'image',
}).map(([path, content]) => [path, strToU8(content)]))

describe('PPTX page recognition', () => {
  it('preserves stacking order and imports editable tables and nested groups', () => {
    const extra = { ...files, 'ppt/slides/slide1.xml': strToU8(`<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="数据表"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="685800"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="6096000"/><a:gridCol w="6096000"/></a:tblGrid><a:tr h="685800"><a:tc><a:txBody><a:p><a:r><a:rPr sz="2000"><a:ea typeface="宋体"/></a:rPr><a:t>游戏</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="003366"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:p><a:r><a:t>收入</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="图文组合"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1219200" y="1371600"/><a:ext cx="2438400" cy="1371600"/><a:chOff x="0" y="0"/><a:chExt cx="1219200" cy="685800"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="11" name="组合文字"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="0"/><a:ext cx="609600" cy="685800"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>说明</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>
    </p:spTree></p:cSld></p:sld>`) }
    const result = parsePptxArchive(extra)
    const [table, group] = result.slides[0].components
    expect(table.tagName).toBe('table')
    const cell = table.components[0].components[0].components[0]
    expect(cell.components[0].type).toBe('text')
    expect(cell.components[0].components).toContain('游戏')
    expect(cell.components[0].components).toContain('宋体')
    expect(cell.style.background).toBe('#003366')
    expect(group.attributes['data-pptx-kind']).toBe('group')
    expect(group.components[0].style.left).toBe('192px')
    expect(group.components[0].style.width).toBe('192px')
    expect(result.slides[0].unsupported).toBe(0)
  })
  it('creates editable text and image objects and marks complex content', () => {
    const result = parsePptxArchive(files, 'sample')
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
    expect(result.slides).toHaveLength(1)
    expect(result.slides[0].components).toHaveLength(3)
    expect(result.slides[0].components[0].components).toContain('月报标题')
    expect(result.slides[0].components[0].components).toContain('font-size:48px')
    expect(result.slides[0].components[0].style.left).toBe('192px')
    expect(result.slides[0].components[1].type).toBe('image')
    expect(result.slides[0].components[1].attributes.src).toMatch(/^data:image\/png;base64,/)
    expect(result.slides[0].components[2].attributes['data-pptx-kind']).toBe('unsupported')
    expect(result.slides[0].unsupported).toBe(1)
  })
})

describe('theme and layout fidelity', () => {
  it('inherits background and placeholder geometry, keeps mixed text styles', () => {
    const more = { ...files,
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships><Relationship Id="layout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'),
      'ppt/slideLayouts/slideLayout1.xml': strToU8('<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="占位标题"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="685800"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>'),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8('<Relationships><Relationship Id="theme" Target="../theme/theme1.xml"/></Relationships>'),
      'ppt/theme/theme1.xml': strToU8('<a:theme xmlns:a="a"><a:clrScheme><a:accent1><a:srgbClr val="123456"/></a:accent1></a:clrScheme></a:theme>'),
      'ppt/slides/slide1.xml': strToU8('<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:noFill/><a:ln><a:solidFill><a:srgbClr val="ff0000"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1" sz="2000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>&lt;标题&gt;</a:t></a:r><a:r><a:rPr b="0"/><a:t>普通文字</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
    }
    const slide = parsePptxArchive(more).slides[0], shape = slide.components[0]
    expect(slide.background).toBe('#123456')
    expect(shape.style.left).toBe('192px')
    expect(shape.style.background).toBe('transparent')
    expect(shape.components).toContain('font-size:40px')
    expect(shape.components).toContain('font-weight:700')
    expect(shape.components).toContain('font-weight:400')
    expect(shape.components).toContain('&lt;标题&gt;')
    expect(shape.components).toContain('color:#123456')
  })
})
