import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {parse} from 'csv-parse/sync';
import {ROOT,PIN,HASHES,AS_OF,sha,safeUrl,readVerified} from './common.mjs';
export const INTAKE=resolve(ROOT,'../.private/node25/upstream',PIN);
export const POSTING_HEADERS=['Posting ID','Title','Company','Ticker','SOC code','SOC group','Job level','Job type','Work arrangement','City','State','Country','Number of locations','Posted','Pay','Minimum degree','Accepts equivalent experience','Years of experience','Skills','Licenses and certifications','Status','Last seen','URL'];
export const COMPANY_HEADERS=['Rank','Ticker','Company','Sector','Career site','Platform','Status','Last collected','Postings in dashboard','Listed on site','Notes'];
const date=v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function parseCsv(bytes,kind){
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const all=parse(decoded,{bom:true,skip_empty_lines:true});const expected=kind==='postings'?POSTING_HEADERS:COMPANY_HEADERS;
  if(JSON.stringify(all.shift())!==JSON.stringify(expected))throw Error('Incompatible '+kind+' CSV headers');
  const rows=[],rejects=[],ids=new Set();
  all.forEach((values,index)=>{const row=Object.fromEntries(expected.map((k,i)=>[k,values[i]]));const reasons=[];const id=kind==='postings'?row['Posting ID']:row.Ticker;
    if(values.length!==expected.length)reasons.push('column_count');
    if(!id||ids.has(id))reasons.push('missing_or_duplicate_id');
    if(kind==='postings'){
      if(!row.Ticker||!id?.startsWith(row.Ticker+':')||!id?.slice(row.Ticker.length+1))reasons.push('invalid_id');
      if(!row.Title?.trim())reasons.push('empty_title');if(row.URL&&!safeUrl(row.URL))reasons.push('unsafe_url');
      if(!['Open','Closed','Possibly closed','Unverified'].includes(row.Status))reasons.push('invalid_status');
      if(!date(row.Posted)||!date(row['Last seen']))reasons.push('invalid_date');
      for(const key of ['Number of locations','Years of experience'])if(row[key]&&(!Number.isFinite(Number(row[key]))||Number(row[key])<0||Number(row[key])>=1e6))reasons.push('invalid_numeric');
      if(!['Yes','No','Not specified',''].includes(row['Accepts equivalent experience']))reasons.push('invalid_equivalence');
    }else if(row['Career site']&&!safeUrl(row['Career site'])||!date(row['Last collected']))reasons.push('invalid_company');
    if(reasons.length)rejects.push({line:index+2,reasons,record:row});else{ids.add(id);rows.push(row);}
  });return {rows,rejects};
}
export function decodeSupplement(bytes,rows,{expectedHash=HASHES['index.html']}={}){
  if(sha(bytes)!==expectedHash)throw Error('Supplement checksum mismatch');
  const match=bytes.toString('utf8').match(/const EMBEDDED = ("[^"\n]+")/);if(!match)throw Error('Missing typed payload');
  const data=JSON.parse(gunzipSync(Buffer.from(JSON.parse(match[1]),'base64')));const typed=new Map();
  if(new Set(data.fields).size!==data.fields.length)throw Error('Duplicate typed fields');
  for(const values of data.rows){if(values.length!==data.fields.length)throw Error('Typed row width');const row=Object.fromEntries(data.fields.map((k,i)=>[k,values[i]]));if(typed.has(row.id))throw Error('Duplicate typed ID');typed.set(row.id,row);}
  if(typed.size!==rows.length)throw Error('Typed inventory size mismatch');
  for(const row of rows){const extra=typed.get(row['Posting ID']);if(!extra)throw Error('Typed ID set mismatch');for(const [a,b]of [['Title','title'],['Ticker','co'],['URL','url'],['Posted','posted'],['Last seen','last_seen']])if((row[a]||null)!==(extra[b]||null))throw Error('Typed shared field mismatch');if((row.Status==='Open')!==extra.open)throw Error('Typed status mismatch');}
  return typed;
}
export async function importUpstream({directory=INTAKE,inputDirectory,typed=true,dryRun=false}={}){
  directory=resolve(directory);if(directory===resolve(ROOT)||directory.startsWith(resolve(ROOT)+'/'))throw Error('Raw intake must stay outside application/deployment root');await mkdir(directory,{recursive:true});
  const report={commit:PIN,asOf:AS_OF,retrievedAt:new Date().toISOString(),dryRun,files:{},typedSupplement:{status:'disabled'}};let postings;
  for(const [filename,kind]of [['Job postings.csv','postings'],['data source.csv','companies']]){
    let bytes;try{bytes=await readFile(join(inputDirectory||directory,filename));}catch(error){if(inputDirectory||error.code!=='ENOENT')throw error;const response=await fetch(`https://raw.githubusercontent.com/yimizhao2015/jobmarket-lens/${PIN}/data/${encodeURIComponent(filename)}`);if(!response.ok)throw Error('Public source fetch HTTP '+response.status);bytes=Buffer.from(await response.arrayBuffer());}
    if(sha(bytes)!==HASHES[filename])throw Error('Pinned CSV checksum mismatch: '+filename);const parsed=parseCsv(bytes,kind);if(kind==='postings')postings=parsed.rows;
    await writeFile(join(directory,filename),bytes);await writeFile(join(directory,kind+'-rejects.json'),JSON.stringify(parsed.rejects));report.files[kind]={sha256:sha(bytes),bytes:bytes.length,rows:parsed.rows.length+parsed.rejects.length,accepted:parsed.rows.length,rejected:parsed.rejects.length};
    if(!dryRun)await writeFile(join(directory,kind+'.json'),JSON.stringify(parsed.rows));
  }
  if(typed){let bytes;try{bytes=await readFile(join(inputDirectory||directory,'index.html'));}catch(error){if(inputDirectory||error.code!=='ENOENT')throw error;const response=await fetch(`https://raw.githubusercontent.com/yimizhao2015/jobmarket-lens/${PIN}/web/index.html`);if(!response.ok)throw Error('Supplement fetch HTTP '+response.status);bytes=Buffer.from(await response.arrayBuffer());}
    try{const decoded=decodeSupplement(bytes,postings);await writeFile(join(directory,'index.html'),bytes);report.typedSupplement={status:'accepted',sha256:sha(bytes),rows:decoded.size};}catch(error){await writeFile(join(directory,'quarantined-index.html'),bytes);report.typedSupplement={status:'quarantined',sha256:sha(bytes),reason:error.message};}
  }
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
async function main(){const args=process.argv.slice(2);const value=k=>args[args.indexOf(k)+1];console.log(JSON.stringify(await importUpstream({directory:args.includes('--output')?value('--output'):INTAKE,inputDirectory:args.includes('--input')?value('--input'):undefined,typed:!args.includes('--no-typed'),dryRun:args.includes('--dry-run')}),null,2));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
