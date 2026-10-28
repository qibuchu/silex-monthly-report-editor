import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const types={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/svg+xml':'svg','image/bmp':'bmp'};
const invalid=message=>Object.assign(Error(message),{status:400});
export function createAssetStore(config){
 const root=path.join(config.dataDir,'assets');
 const url=id=>`${config.publicUrl}/api/projects/${id}/assets/`;
 const validId=id=>/^[a-f\d-]+$/i.test(id);
 function put(id,source){
  if(!validId(id)||typeof source!=='string')throw invalid('Invalid image asset');
  const match=source.match(/^data:(image\/[a-z+]+);base64,([A-Za-z\d+/=]+)$/);
  if(!match||!types[match[1]])throw invalid('Unsupported image type');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>25*1024*1024)throw invalid('单个图片资源须小于25MB');
  const file=createHash('sha256').update(bytes).digest('hex')+'.'+types[match[1]];
  const directory=path.join(root,id);fs.mkdirSync(directory,{recursive:true});
  if(!fs.existsSync(path.join(directory,file)))fs.writeFileSync(path.join(directory,file),bytes);
  return {src:url(id)+file};
 }
 function get(id,file){
  if(!validId(id)||! /^[a-f\d]{64}\.(png|jpg|gif|webp|svg|bmp)$/.test(file))throw invalid('Invalid asset path');
  const target=path.join(root,id,file);
  if(!fs.existsSync(target))throw Object.assign(Error('图片资源不存在'),{status:404});
  const mime=Object.keys(types).find(k=>types[k]===file.split('.').pop());
  return {bytes:fs.readFileSync(target),mime};
 }
 function pack(value,embedded=false){
  let serialized=JSON.stringify(value);const assets={};
  const refs=[...new Set(serialized.match(/https?:\/\/[^\s"<>\\]+\/api\/projects\/[a-f\d-]+\/assets\/[a-f\d]{64}\.(?:png|jpg|gif|webp|svg|bmp)/gi)||[])];
  for(const ref of refs){
   const parsed=new URL(ref);if(parsed.origin!==new URL(config.publicUrl).origin)continue;
   const match=parsed.pathname.match(/^\/api\/projects\/([a-f\d-]+)\/assets\/(.+)$/);if(!match)continue;
   const {bytes,mime}=get(match[1],match[2]);const data=`data:${mime};base64,${bytes.toString('base64')}`;
   const token='monthly-asset:'+match[2];assets[token]=data;
   serialized=serialized.split(ref).join(embedded?data:token);
  }
  return {value:JSON.parse(serialized),assets};
 }
 function unpack(id,value,assets){
  let serialized=JSON.stringify(value);
  for(const [token,data] of Object.entries(assets||{})){
   if(!/^monthly-asset:[a-f\d]{64}\.(png|jpg|gif|webp|svg|bmp)$/.test(token))throw invalid('Invalid archive image key');
   const {src}=put(id,data);if(!src.endsWith(token.slice('monthly-asset:'.length)))throw invalid('Archive asset hash mismatch');
   serialized=serialized.split(token).join(src);
  }
  if(serialized.includes('monthly-asset:'))throw invalid('可编辑项目缺少配套图片资源');
  return JSON.parse(serialized);
 }
 return {put,get,pack,unpack};
}
