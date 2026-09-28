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
  it('creates editable text and image objects and marks complex content', () => {
    const result = parsePptxArchive(files, 'sample')
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
    expect(result.slides).toHaveLength(1)
    expect(result.slides[0].components).toHaveLength(3)
    expect(result.slides[0].components[0].components).toBe('月报标题')
    expect(result.slides[0].components[0].style.left).toBe('192px')
    expect(result.slides[0].components[1].type).toBe('image')
    expect(result.slides[0].components[1].attributes.src).toMatch(/^data:image\/png;base64,/)
    expect(result.slides[0].components[2].attributes['data-pptx-kind']).toBe('unsupported')
    expect(result.slides[0].unsupported).toBe(1)
  })
})
