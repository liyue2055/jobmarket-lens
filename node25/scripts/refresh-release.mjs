/** Explicit release construction from registered source bytes and the unchanged public local seed. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,sha,canonical,validateSeed,validate,safeUrl,readVerified} from './common.mjs';
import {sourceCandidate,DEFAULT_CANDIDATE,auditSnapshot} from './pull-snapshot.mjs';
import {parseCsv,decodeSupplement} from './import-upstream.mjs';
import {upstreamRecord,mergeRecords} from './original-source.mjs';
import {materialize,verifyStore,assertPopulations} from './materialize.mjs';

export function normalizeDeclaredCurrencyPay(value){
  const match=String(value||'').match(/^([A-Z]{3})\s+([\d,.]+)(?:[–-]\1\s+([\d,.]+))?\s+per\s+(hour|month|year)$/);
  if(!match)return value;
  const [,currency,low,high,period]=match;
  return `${low} - ${high||low} ${currency} per ${period}`;
}

export async function loadCandidateRelease({commit=DEFAULT_CANDIDATE,
  directory=resolve(ROOT,'../.private/upstream-candidates',commit),
  seedPath=join(ROOT,'store/local-seed.json')}={}) {
  const candidate=sourceCandidate(commit),files={};
  for(const [name,spec]of Object.entries(candidate.files)) {
    files[name]=await readVerified(join(directory,name),spec.sha256);
    if(files[name].length!==spec.bytes)throw Error('Candidate byte-length mismatch');
  }
  const seed=validateSeed(JSON.parse(await readFile(seedPath,'utf8')));
  const audit=auditSnapshot(files,candidate,seed.localPostings.map(r=>r.id),seed.localPostings.map(r=>r.companyId));
  const parsed=parseCsv(files['Job postings.csv'],'postings');
  const companies=parseCsv(files['data source.csv'],'companies').rows;
  const typed=decodeSupplement(files['index.html'],parsed.rows,{expectedHash:candidate.files['index.html'].sha256});
  const upstream=parsed.rows.map(row=>upstreamRecord({...row,Pay:normalizeDeclaredCurrencyPay(row.Pay)},typed.get(row['Posting ID']),{commit,asOf:candidate.asOf}));
  const local=structuredClone(seed.localPostings),upMap=new Map(upstream.map(r=>[r.id,r])),loMap=new Map(local.map(r=>[r.id,r]));
  const combined=[...new Set([...upMap.keys(),...loMap.keys()])].sort().map(id=>upMap.has(id)&&loMap.has(id)?mergeRecords(upMap.get(id),loMap.get(id)):upMap.get(id)||loMap.get(id));
  const catalog=structuredClone(seed.catalog),catalogCompanies=new Map(catalog.companies.map(c=>[c.id,c]));
  for(const c of companies)catalogCompanies.set(c.Ticker,{id:c.Ticker,name:c.Company,sector:c.Sector||null,careerUrl:safeUrl(c['Career site'])});
  catalog.companies=[...catalogCompanies.values()].sort((a,b)=>a.id.localeCompare(b.id));
  catalog.sources=[{id:'upstream:'+commit,kind:'upstream',asOf:candidate.asOf,commit,completeness:'unknown'},
    ...seed.catalog.sources.filter(s=>s.kind==='local')];
  validate(catalog.companies,'companies');validate(catalog.sources,'sources');validate(catalog.taxonomy,'taxonomy');
  const methods={...seed.methods,import:'csv-1',pay:'csv-audited-typed-currency-2'};
  const sourceDatasetVersion=sha(canonical({upstream:{commit,asOf:candidate.asOf,files:candidate.files},
    localSeedSha256:sha(canonical(seed)),methods}));
  const data={modes:{combined,upstream:upstream.sort((a,b)=>a.id.localeCompare(b.id)),local},catalog,
    asOf:candidate.asOf,methods,localSeed:seed,sourceDatasetVersion,
    limitations:[...seed.limitations,'Upstream commit time is release provenance; retained local observation dates and detail freshness remain separate.',
      'This Node snapshot is refreshed independently of the preserved V2 React release.']};
  const populations=assertPopulations(data);
  if(populations.counts.upstream!==audit.postings||populations.counts.combined!==audit.local.prospectiveCombined||
    populations.counts.overlap!==audit.local.overlap)throw Error('Normalized populations differ from audited source union');
  return {data,audit,sourceDatasetVersion};
}
export async function refreshRelease({commit=DEFAULT_CANDIDATE,directory,
  output=resolve(ROOT,'../.private/releases',commit,'node25')}={}) {
  const {data,audit,sourceDatasetVersion}=await loadCandidateRelease({commit,directory});
  await mkdir(output,{recursive:true});
  // Keep the original seed and historical run ledger; they are not relabeled as new observations.
  await copyFile(join(ROOT,'store/local-seed.json'),join(output,'local-seed.json'));
  try{await copyFile(join(ROOT,'store/collection-history.json'),join(output,'collection-history.json'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const release=await materialize(data,output);await verifyStore(output);
  const report={commit,sourceAsOf:data.asOf,sourceDatasetVersion,datasetVersion:release.datasetVersion,
    counts:release.counts,eligiblePayByMode:release.eligiblePayByMode,audit,
    representedEmployers:Object.fromEntries(Object.entries(data.modes).map(([mode,rows])=>[mode,new Set(rows.map(r=>r.companyId)).size])),
    defaultOpen:Object.fromEntries(Object.entries(data.modes).map(([mode,rows])=>[mode,rows.filter(r=>['local_observed','upstream_reported_open'].includes(r.availability)).length])),
    files:release.files};
  await writeFile(join(output,'refresh-report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
async function main(){
  const args=process.argv.slice(2);const get=key=>{const i=args.indexOf(key);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(key+' requires a value');return args[i+1]};
  for(let i=0;i<args.length;i+=2)if(!['--commit','--input','--output'].includes(args[i]))throw Error('Unknown release option');
  console.log(JSON.stringify(await refreshRelease({commit:get('--commit')||DEFAULT_CANDIDATE,
    directory:get('--input')?resolve(get('--input')):undefined,output:get('--output')?resolve(get('--output')):undefined}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{console.error(e.message);process.exitCode=1});
