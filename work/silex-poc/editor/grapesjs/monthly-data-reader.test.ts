import {zipSync,strToU8} from 'fflate'
import {readXlsx} from './monthly-data-reader'
const fixture = (sheets: {name:string,rows:string[][]}[]) => {
 const files:Record<string,Uint8Array> = {}
 files['xl/workbook.xml']=strToU8(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${s.name}" r:id="r${i}"/>`).join('')}</sheets></workbook>`)
 files['xl/_rels/workbook.xml.rels']=strToU8(`<Relationships>${sheets.map((_,i)=>`<Relationship Id="r${i}" Target="worksheets/s${i}.xml"/>`).join('')}</Relationships>`)
 sheets.forEach((s,i)=>{files[`xl/worksheets/s${i}.xml`]=strToU8(`<worksheet><sheetData>${s.rows.map((r,j)=>`<row r="${j+1}">${r.map((v,k)=>`<c r="${String.fromCharCode(65+k)}${j+1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`)})
 return zipSync(files)
}
describe('Excel data and reference worksheets',()=>{
 it('preserves scope notes without blocking data sheets or matching note fields as metrics',()=>{
  const result=readXlsx(fixture([{name:'口径说明',rows:[['统计窗口为2026年8月'],['收入不含广告估算']]},{name:'字段说明',rows:[['字段','含义'],['收入','已计算收入']]},{name:'营收数据',rows:[['游戏名','收入'],['测试游戏','100']]}]),'测试.xlsx')
  expect(result.tables).toHaveLength(1);expect(result.tables[0].rows[0]).toEqual(['测试游戏','100'])
  expect(result.referenceSheets).toHaveLength(2);expect(result.referenceSheets[0].rows[0][0]).toBe('统计窗口为2026年8月')
 })
 it('retains unstructured content and clearly requests data when no data sheet exists',()=>{
  const result=readXlsx(fixture([{name:'Sheet1',rows:[['没有表头的单列内容'],['仍需人工核对']]}]),'单列.xlsx')
  expect(result.tables).toHaveLength(0);expect(result.referenceSheets[0].rows).toHaveLength(2);expect(result.warnings.join(' ')).toMatch(/补充/)
 })
})
