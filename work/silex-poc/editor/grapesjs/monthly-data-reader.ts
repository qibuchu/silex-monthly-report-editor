// @ts-nocheck
import {unzipSync,strFromU8} from 'fflate'
import {renderImportedChart} from './pptx-chart'
const xml=(s:string)=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('Excel XML解析失败');return d}
const nodes=(d:any,n:string)=>Array.from(d.getElementsByTagNameNS('*',n)) as any[]
function csv(s:string,delimiter:string){const rows=[],row=[];let v='',quote=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quote&&s[i+1]==='"'){v+='"';i++}else quote=!quote}else if(!quote&&(c===delimiter||c==='\n'||c==='\r')){row.push(v);v='';if(c!==delimiter){rows.push(row.splice(0));if(c==='\r'&&s[i+1]==='\n')i++}}else v+=c}if(quote)throw Error('CSV引号未闭合');if(v||row.length){row.push(v);rows.push(row)}return rows}
function table(name:string,matrix:any[]){const h=matrix.findIndex(r=>r.filter(v=>String(v).trim()).length>=2&&r.some(v=>v&&!/^[-+\d.,%]+$/.test(v)));if(h<0)throw Error(name+'未找到带字段名称的表头');let start=0,end=matrix[h].length;while(start<end&&!String(matrix[h][start]).trim())start++;while(end>start&&!String(matrix[h][end-1]).trim())end--;const columns=matrix[h].slice(start,end).map(String);return {name,columns,headerRow:h+1,rows:matrix.slice(h+1).filter(r=>r.some(v=>String(v).trim())).map(r=>columns.map((_,i)=>String(r[start+i]??'')))}}
export function readXlsx(bytes:Uint8Array,name:string){
 let uncompressed=0;const zip=unzipSync(bytes,{filter:entry=>{uncompressed+=entry.originalSize;if(uncompressed>50*1024*1024)throw Error('Excel解压内容超过50MB');return /^(xl\/.*\.xml|xl\/.*\.rels)$/.test(entry.name)}});
 const read=(p:string)=>zip[p]?xml(strFromU8(zip[p])):null,workbook=read('xl/workbook.xml'),rels=read('xl/_rels/workbook.xml.rels');if(!workbook||!rels)throw Error('不支持的Excel文件，请另存为.xlsx');
 const shared=nodes(read('xl/sharedStrings.xml')||xml('<s/>'),'si').map(n=>nodes(n,'t').map(t=>t.textContent||'').join(''));
 const styles=read('xl/styles.xml'),formats=new Map(nodes(styles||xml('<s/>'),'numFmt').map(n=>[n.getAttribute('numFmtId'),n.getAttribute('formatCode')]));
 const xfs=styles?nodes(styles,'cellXfs')[0]:null,formatIds=xfs?Array.from(xfs.children).map((n:any)=>n.getAttribute('numFmtId')):[];
 const lookup=new Map(nodes(rels,'Relationship').map(n=>[n.getAttribute('Id'),n.getAttribute('Target')])),tables=[],referenceSheets=[],warnings=[];
 for(const sheet of nodes(workbook,'sheet')){const link=lookup.get(sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))||'',path=link.startsWith('/')?link.slice(1):'xl/'+link.replace(/^\.\//,'');if(path.includes('..'))throw Error('Excel工作表路径不受支持');const doc=read(path);if(!doc)continue;const matrix=[];
  for(const row of nodes(doc,'row')){if(matrix.length>=10001)throw Error('Excel单表最多10000行');const r=[];for(const c of nodes(row,'c')){const addr=c.getAttribute('r')||'',letters=addr.match(/^[A-Z]+/)?.[0]||'A';let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;col--;if(col>=100)throw Error('Excel单表最多100列');const type=c.getAttribute('t'),raw=nodes(c,'v')[0]?.textContent||'',f=nodes(c,'f')[0];let value=type==='s'?shared[Number(raw)]||'':type==='inlineStr'?nodes(c,'t').map(n=>n.textContent||'').join(''):raw;
    if(f&&!raw){warnings.push(sheet.getAttribute('name')+'!'+addr+'公式没有缓存值，已留空；请在Excel中重算后保存');value=''}
    const fmtId=formatIds[Number(c.getAttribute('s')||0)],fmt=formats.get(fmtId)||'',percent=['9','10'].includes(fmtId)||/%/.test(fmt);
    if(type!=='s'&&raw&&percent){const decimals=fmtId==='9'?0:fmtId==='10'?2:(fmt.match(/\.([0#]+).*%/)?.[1].length||0);value=(Number(raw)*100).toFixed(decimals)+'%'}
    else if(type!=='s'&&raw&&(['14','15','16','17','18','19','20','21','22'].includes(fmtId)||/[yd]/i.test(fmt.replace(/"[^"]*"/g,'')))){const epoch=nodes(workbook,'workbookPr')[0]?.getAttribute('date1904')==='1'?Date.UTC(1904,0,1):Date.UTC(1899,11,30),date=new Date(epoch+Number(raw)*86400000);if(Number.isFinite(date.getTime()))value=date.toISOString().slice(0,10)}
    r[col]=value;
   }matrix.push(Array.from({length:r.length},(_,i)=>r[i]??''))}
  if(!matrix.some(r=>r.some(Boolean)))continue;
  const sheetName=sheet.getAttribute('name')||'Sheet',isReference=/^(?:\d+[.、 _-]*)?(?:口径说明|统计口径|数据说明|字段说明|说明|备注|填报指南|使用指南|readme|instructions|notes)(?:[\s（(].*)?$/i.test(sheetName);
  const hasHeader=matrix.some(r=>r.filter(v=>String(v).trim()).length>=2&&r.some(v=>v&&!/^[-+\d.,%]+$/.test(v)));
  if(isReference||!hasHeader){const reason=isReference?'说明/口径工作表，作为参考材料保留，不参与字段匹配':'未识别到带字段名称的表头，原内容已保留供核对，不参与自动匹配';referenceSheets.push({name:sheetName,reason,rows:matrix});warnings.push(sheetName+'：'+reason);continue;}
  tables.push(table(sheetName,matrix));
 }if(!tables.length&&!referenceSheets.length)throw Error('Excel中没有可读取的内容');if(!tables.length)warnings.push('此文件仅包含说明或未识别为表格的内容，请补充带字段表头的数据工作表或其他数据文件');return {name,tables,scalars:[],referenceSheets,warnings:[...new Set(warnings)]}
}
async function read(file:File){if(file.size>10*1024*1024)throw Error('单个数据文件最大10MB');const extension=file.name.split('.').pop()?.toLowerCase();if(extension==='xlsx')return readXlsx(new Uint8Array(await file.arrayBuffer()),file.name);if(extension==='xls')throw Error('旧版.xls请先另存为.xlsx');if(extension==='csv'||extension==='tsv'){const bytes=new Uint8Array(await file.arrayBuffer());let text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);if(text.includes('\uFFFD'))text=new TextDecoder('gb18030').decode(bytes);return {name:file.name,tables:[table(file.name,csv(text.replace(/^\uFEFF/,''),extension==='tsv'?'\t':','))],scalars:[],warnings:[]}}if(extension==='json')return {name:file.name,json:JSON.parse(await file.text())};throw Error('请选择.xlsx、.csv、.tsv或.json文件')}
Object.assign(window,{MonthlyData:{read,renderChart:renderImportedChart}})
