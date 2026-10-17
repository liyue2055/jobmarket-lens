import {readFile,writeFile,mkdir,rename,mkdtemp,rm,access,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DuckDBInstance} from '@duckdb/node-api';
import {ReleaseSchema} from './release-contract.mjs';
import {HistorySchema} from './history-contract.mjs';
import {ROOT,SOURCE_VERSION,AS_OF,sha,canonical,validate,readVerified,validateSeed} from './common.mjs';

export async function loadV2(directory){
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));validate(manifest,'manifest');
  if(manifest.datasetVersion!==SOURCE_VERSION)throw Error('Unexpected source release; explicit new audit required');
  const modes={combined:[],upstream:[],local:[]};const catalog={};let limitations=[];
  for(const file of manifest.files){
    const path=resolve(directory,file.path);if(!path.startsWith(resolve(directory)+'/'))throw Error('Unsafe manifest path');
    const bytes=await readVerified(path,file.sha256);if(bytes.length!==file.bytes)throw Error('Source byte-length mismatch');
    const data=JSON.parse(bytes);validate(data,file.kind==='postings'?'shard':file.kind);
    if(file.kind==='postings'){if(data.sourceMode!==file.sourceMode||data.postings.length!==file.recordCount)throw Error('Source shard metadata mismatch');modes[data.sourceMode].push(...data.postings);}
    else if(file.kind==='summary')limitations=data.limitations;else catalog[file.kind]=data;
  }
  return {modes,catalog,asOf:AS_OF,methods:manifest.methods,limitations,sourceDatasetVersion:manifest.datasetVersion};
}

export function assertPopulations(data){
  const sets={};const pay={};
  const companies=new Set(data.catalog.companies.map(c=>c.id));const sources=new Set(data.catalog.sources.map(s=>s.id));
  const skillIds=new Set(data.catalog.taxonomy.skills.map(s=>s.id));const occupationIds=new Set(data.catalog.taxonomy.occupations.map(s=>s.id));
  for(const [mode,rows] of Object.entries(data.modes)){
    sets[mode]=new Set();pay[mode]=0;
    for(const r of rows){validate(r,'posting');if(sets[mode].has(r.id))throw Error('Duplicate mode/id: '+mode+'/'+r.id);sets[mode].add(r.id);
      if(!companies.has(r.companyId)||!r.sourceIds.every(s=>sources.has(s))||!Object.values(r.provenance).every(s=>sources.has(s))||!Object.values(r.fieldProvenance).every(s=>sources.has(s)))throw Error('Broken public catalog/provenance reference');
      if(!r.skillIds.every(s=>skillIds.has(s))||(r.occupationId&&!occupationIds.has(r.occupationId)))throw Error('Broken public taxonomy reference');
      if(r.hasDescription===true&&!r.provenance.skills.startsWith('local:'))throw Error('Analyzed-text basis mismatch');
      if(r.pay?.valid&&r.pay.currency==='USD'&&Number.isFinite(r.pay.annualLow)&&Number.isFinite(r.pay.annualHigh))pay[mode]++;
    }
  }
  const union=new Set([...sets.upstream,...sets.local]);if(union.size!==sets.combined.size||[...union].some(id=>!sets.combined.has(id)))throw Error('Combined is not exact source union');
  return {counts:{combined:sets.combined.size,upstream:sets.upstream.size,local:sets.local.size,overlap:[...sets.local].filter(id=>sets.upstream.has(id)).length,rejected:0},pay};
}

export async function verifyStore(directory=join(ROOT,'store'),{deep=true}={}){
  const release=ReleaseSchema.parse(JSON.parse(await readFile(join(directory,'release.json'),'utf8')));
  validate(release.catalog.sources,'sources');validate(release.collection.sources,'sources');
  for(const file of release.files){if(file.path!==file.path.split('/').at(-1))throw Error('Unsafe store filename');const bytes=await readVerified(join(directory,file.path),file.sha256);if(bytes.length!==file.bytes)throw Error('Store byte length mismatch');}
  if(!release.files.some(f=>f.path==='postings.parquet')||new Set(release.files.map(f=>f.path)).size!==release.files.length)throw Error('Unexpected public store layout');
  const historyFile=release.files.find(f=>f.path==='collection-history.json');
  if(historyFile){const history=HistorySchema.parse(JSON.parse(await readFile(join(directory,historyFile.path),'utf8')));if(canonical(history.runs)!==canonical(release.collection.runs))throw Error('Historical admin metadata mismatch');}
  else if(release.collection.runs.length)throw Error('Unverified historical admin metadata');
  if(deep)await deepVerifyStore(directory,release);
  return release;
}

export async function deepVerifyStore(directory,release){
  const seed=validateSeed(JSON.parse(await readFile(join(directory,'local-seed.json'),'utf8')));
  const companies=new Set(release.catalog.companies.map(x=>x.id)),occupations=new Set(release.catalog.occupations.map(x=>x.id)),skills=new Set(release.catalog.skills.map(x=>x.id)),sources=new Set(release.catalog.sources.map(x=>x.id)),licenses=new Set(seed.catalog.taxonomy.licenses.map(x=>x.id));
  const seedLocal=new Map(seed.localPostings.map(row=>[row.id,canonical(row)]));
  const sets={combined:new Set(),upstream:new Set(),local:new Set()},pay={combined:0,upstream:0,local:0};
  const allowed=['mode','id','companyId','title','occupationId','level','arrangement','availability','hasDescription','eligiblePay','annualLow','annualHigh','countries','skillIds','detailJSON'];
  const db=await DuckDBInstance.create(':memory:',{threads:'2',memory_limit:'512MB'});const c=await db.connect();
  try{
    const path=join(directory,'postings.parquet').replaceAll("'","''");const result=await c.stream(`SELECT * FROM read_parquet('${path}')`);
    if(canonical(result.columnNames().slice().sort())!==canonical(allowed.slice().sort()))throw Error('Unexpected physical public columns');
    for await(const rows of result.yieldRowObjectJs())for(const entry of rows){
      if(!sets[entry.mode]||sets[entry.mode].has(entry.id))throw Error('Duplicate/invalid physical mode identity');sets[entry.mode].add(entry.id);
      const r=JSON.parse(entry.detailJSON);validate(r,'posting');
      if(entry.mode==='local'&&canonical(r)!==seedLocal.get(r.id))throw Error('Published local row differs from retained sanitized seed');
      for(const key of ['id','companyId','title','occupationId','level','arrangement','availability','hasDescription'])if(entry[key]!==r[key])throw Error('Physical/detail value mismatch');
      if(!companies.has(r.companyId)||(r.occupationId&&!occupations.has(r.occupationId))||!r.skillIds.every(x=>skills.has(x))||!r.licenseIds.every(x=>licenses.has(x))||!r.sourceIds.every(x=>sources.has(x))||!sources.has(r.availabilitySourceId)||!Object.values(r.provenance).every(x=>sources.has(x))||!Object.values(r.fieldProvenance).every(x=>sources.has(x)))throw Error('Broken public reference');
      if(r.hasDescription===true&&!r.provenance.skills.startsWith('local:'))throw Error('Analyzed-text source mismatch');
      if(canonical(entry.skillIds)!==canonical(r.skillIds)||canonical(entry.countries)!==canonical([...new Set(r.locations.map(l=>l.country).filter(Boolean))]))throw Error('Physical bridge/detail mismatch');
      if(r.pay?.valid&&(!Number.isFinite(r.pay.annualLow)||!Number.isFinite(r.pay.annualHigh)||r.pay.annualLow<0||r.pay.annualHigh<r.pay.annualLow||r.pay.annualHigh>1000000||r.pay.flags.length))throw Error('Invalid eligible pay contract');
      const eligible=Boolean(r.pay?.valid&&r.pay.currency==='USD'&&Number.isFinite(r.pay.annualLow)&&Number.isFinite(r.pay.annualHigh));if(entry.eligiblePay!==eligible||entry.annualLow!==(r.pay?.annualLow??null)||entry.annualHigh!==(r.pay?.annualHigh??null))throw Error('Physical salary/detail mismatch');if(eligible)pay[entry.mode]++;
    }
    for(const mode of Object.keys(sets))if(sets[mode].size!==release.counts[mode]||pay[mode]!==release.eligiblePayByMode[mode])throw Error('Materialized count/pay mismatch');
    if(sets.local.size!==seedLocal.size)throw Error('Published local population differs from retained seed');
    const union=new Set([...sets.local,...sets.upstream]);if(union.size!==sets.combined.size||[...union].some(id=>!sets.combined.has(id))||[...sets.local].filter(id=>sets.upstream.has(id)).length!==release.counts.overlap)throw Error('Materialized source union mismatch');
  }finally{c.closeSync();db.closeSync();}
}

export function semanticIdentity(data){
  // Exact canonical identity, streamed by row to avoid one giant snapshot string.
  const hash=createHash('sha256');hash.update('{');
  const fields={modes:data.modes,catalog:data.catalog,methods:data.methods,asOf:data.asOf};
  const keys=Object.keys(fields).sort();
  keys.forEach((key,i)=>{if(i)hash.update(',');hash.update(JSON.stringify(key)+':');
    if(key!=='modes'){hash.update(canonical(fields[key]));return;}
    hash.update('{');Object.keys(data.modes).sort().forEach((mode,j)=>{
      if(j)hash.update(',');hash.update(JSON.stringify(mode)+':[');
      data.modes[mode].forEach((row,k)=>{if(k)hash.update(',');hash.update(canonical(row));});hash.update(']');
    });hash.update('}');
  });hash.update('}');return hash.digest('hex');
}

export async function materialize(data,directory=join(ROOT,'store')){
  const {counts,pay}=assertPopulations(data);
  await mkdir(directory,{recursive:true});
  const seedPayload=data.localSeed?validateSeed(data.localSeed):validateSeed({catalog:data.catalog,asOf:data.asOf,methods:data.methods,limitations:data.limitations,sourceDatasetVersion:data.sourceDatasetVersion,localPostings:data.modes.local});
  if(canonical(seedPayload.localPostings)!==canonical(data.modes.local))throw Error('Local observations differ from the validated sanitized seed');
  try{validateSeed(JSON.parse(await readFile(join(directory,'local-seed.json'),'utf8')));}
  catch(error){if(error.code!=='ENOENT')throw error;await writeFile(join(directory,'local-seed.json'),JSON.stringify(seedPayload)+'\n');}
  const temp=await mkdtemp(join(tmpdir(),'lens-node25-'));await mkdir(directory,{recursive:true});
  const identity=semanticIdentity(data);
  const release={datasetVersion:identity,sourceDatasetVersion:data.sourceDatasetVersion,counts,catalog:{companies:data.catalog.companies.map(({id,name})=>({id,name})),occupations:data.catalog.taxonomy.occupations.map(({id,name})=>({id,name})),skills:data.catalog.taxonomy.skills.map(({id,name})=>({id,name})),sources:data.catalog.sources},asOf:data.asOf,methods:{...data.methods,nodeMaterializer:'native-parquet-1'},limitations:[...data.limitations,'Node release reuses sanitized local observations; live Node source collection is not scheduled.'],files:[],eligiblePayByMode:pay,collection:{counts:{postings:counts.local,employers:new Set(data.modes.local.map(r=>r.companyId)).size},sources:data.catalog.sources,lastSnapshot:data.modes.local.reduce((last,r)=>r.lastObservedAt>last?r.lastObservedAt:last,'' )||null,scheduled:false,runs:[],limitations:['No Node collector has run. Imported snapshot metadata is not a collection-run ledger.','Existing Python collection adapters are not automatically supported by this separate Node application.']}};
  let db,connection;
  try{
    const input=join(temp,'public.ndjson');const handle=await open(input,'w');
    try{
      for(const [mode,rows]of Object.entries(data.modes))for(let start=0;start<rows.length;start+=1000){
        const batch=rows.slice(start,start+1000).map(row=>JSON.stringify({mode,id:row.id,companyId:row.companyId,title:row.title,occupationId:row.occupationId,level:row.level,arrangement:row.arrangement,availability:row.availability,hasDescription:row.hasDescription,eligiblePay:Boolean(row.pay?.valid&&row.pay.currency==='USD'&&Number.isFinite(row.pay.annualLow)&&Number.isFinite(row.pay.annualHigh)),annualLow:row.pay?.annualLow??null,annualHigh:row.pay?.annualHigh??null,countries:[...new Set(row.locations.map(l=>l.country).filter(Boolean))],skillIds:row.skillIds,detailJSON:JSON.stringify(row)}));
        await handle.write(batch.join('\n')+'\n');
      }
    }finally{await handle.close();}
    db=await DuckDBInstance.create(':memory:',{threads:'2',memory_limit:'512MB'});connection=await db.connect();
    const columns={mode:'VARCHAR',id:'VARCHAR',companyId:'VARCHAR',title:'VARCHAR',occupationId:'VARCHAR',level:'VARCHAR',arrangement:'VARCHAR',availability:'VARCHAR',hasDescription:'BOOLEAN',eligiblePay:'BOOLEAN',annualLow:'DOUBLE',annualHigh:'DOUBLE',countries:'VARCHAR[]',skillIds:'VARCHAR[]',detailJSON:'VARCHAR'};
    const columnSql=Object.entries(columns).map(([k,v])=>`'${k}':'${v}'`).join(',');
    const quote=s=>"'"+s.replaceAll("'","''")+"'";
    await connection.run(`CREATE TABLE postings AS SELECT * FROM read_json(${quote(input)}, format='newline_delimited', columns={${columnSql}})`);
    const actual=(await connection.runAndReadAll('SELECT mode,count(*)::INTEGER n,count(DISTINCT id)::INTEGER ids FROM postings GROUP BY mode')).getRowObjects();
    for(const row of actual)if(row.n!==counts[row.mode]||row.ids!==row.n)throw Error('Materialized population mismatch');
    const parquet=join(temp,'postings.parquet');await connection.run(`COPY (SELECT * FROM postings ORDER BY mode,id) TO ${quote(parquet)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 8192)`);
    const bytes=await readFile(parquet);release.files=[{path:'postings.parquet',sha256:sha(bytes),bytes:bytes.length}];
    try{const historyBytes=await readFile(join(directory,'collection-history.json'));const history=HistorySchema.parse(JSON.parse(historyBytes));release.collection.runs=history.runs;release.files.push({path:'collection-history.json',sha256:sha(historyBytes),bytes:historyBytes.length});}catch(error){if(error.code!=='ENOENT')throw error;}
    const staged=join(directory,'postings.parquet.tmp');await writeFile(staged,bytes);await rename(staged,join(directory,'postings.parquet'));
    await writeFile(join(directory,'release.json.tmp'),JSON.stringify(release,null,2)+'\n');await rename(join(directory,'release.json.tmp'),join(directory,'release.json'));
    return release;
  }finally{connection?.closeSync();db?.closeSync();await rm(temp,{recursive:true,force:true});}
}

async function main(){
  const args=process.argv.slice(2);const value=key=>args[args.indexOf(key)+1];
  const store=args.includes('--output')?resolve(value('--output')):join(ROOT,'store');
  if(!args.some(a=>['--rebuild','--from-v2','--from-upstream'].includes(a))){const release=await verifyStore(store);console.log('Verified committed Node store',release.datasetVersion,release.counts);return;}
  let data;
  if(args.includes('--from-upstream')){const {loadOriginal}=await import('./original-source.mjs');data=await loadOriginal(args.includes('--intake-dir')?resolve(value('--intake-dir')):undefined);}
  else data=await loadV2(args.includes('--from-v2')?resolve(value('--from-v2')):resolve(ROOT,'../frontend/public/data'));
  const release=await materialize(data,store);console.log(JSON.stringify({datasetVersion:release.datasetVersion,counts:release.counts,eligiblePayByMode:release.eligiblePayByMode,files:release.files},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
