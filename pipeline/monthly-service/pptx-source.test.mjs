import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCore} from './core.mjs';
import {backupStore,restoreStore} from './maintenance.mjs';

function smallPptx(){
  const names=['[Content_Types].xml','ppt/presentation.xml'];
  const local=[],central=[];let offset=0;
  for(const name of names){
    const filename=Buffer.from(name),entry=Buffer.alloc(30+filename.length),index=Buffer.alloc(46+filename.length);
    entry.writeUInt32LE(0x04034b50,0);entry.writeUInt16LE(filename.length,26);filename.copy(entry,30);
    index.writeUInt32LE(0x02014b50,0);index.writeUInt16LE(filename.length,28);index.writeUInt32LE(offset,42);filename.copy(index,46);
    local.push(entry);central.push(index);offset+=entry.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const project={format:'steam-grapesjs-v2',deck:{css:'',notes:{template_origin:'pptx',pptx_imports:[{pages:[]}]},pages:[{name:'封面',width:1280,height:720,objects:[{attributes:{'data-object-id':'title','data-kind':'text'},style:{left:'0px',top:'0px'},content:'<p>模板</p>'}]}]}};

test('uploaded PPTX source is immutable, revision checked, and included in restore',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-pptx-source-'));
  try{
    const dataDir=path.join(root,'data'),core=createCore({dataDir,publicUrl:'http://127.0.0.1:4320'});
    const created=core.importPptxTemplate({title:'PPT模板',project});
    const bytes=smallPptx(),sha256=createHash('sha256').update(bytes).digest('hex');
    assert.throws(()=>core.putTemplatePptx(created.templateId,bytes,2),e=>e.status===409);
    assert.throws(()=>core.putTemplatePptx(created.templateId,Buffer.from('not a pptx'),1),e=>e.status===400);
    const saved=core.putTemplatePptx(created.templateId,bytes,1);
    assert.equal(saved.sourcePptx.sha256,sha256);
    assert.deepEqual(fs.readFileSync(path.join(dataDir,'template-pptx',sha256+'.pptx')),bytes);
    assert.equal(core.putTemplatePptx(created.templateId,bytes,1).sourcePptx.sha256,sha256);
    core.db.templates[created.templateId].revision=1;
    assert.rejects(core.call('generate_native_pptx',{month:'2026-08',templateId:created.templateId,data:{report_month:'2026-08',snapshot_id:'sample'},audit:{month:'2026-08',snapshot_id:'sample',contract_errors:[]}}),/尚无经过审核的原生对象映射/);
    assert.throws(()=>core.putTemplatePptx(created.templateId,Buffer.concat([bytes,Buffer.from('changed')]),1),e=>e.status===400);
    const backup=backupStore(dataDir,path.join(root,'backups'));
    assert.ok(backup.files>=2);
    const restored=path.join(root,'restored');restoreStore(backup.directory,restored);
    assert.deepEqual(fs.readFileSync(path.join(restored,'template-pptx',sha256+'.pptx')),bytes);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
