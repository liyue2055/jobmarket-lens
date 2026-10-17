import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT,PIN,AS_OF,HASHES,SOURCE_VERSION,sha,canonical,text,safeUrl,stableId,readVerified,validateSeed} from './common.mjs';
import {INTAKE,parseCsv,decodeSupplement} from './import-upstream.mjs';
const unique=x=>[...new Set(x)].sort();
export function pyRound(value,digits=0){const scale=10**digits;const x=value*scale;const floor=Math.floor(x);return (x-floor===0.5?(floor%2===0?floor:floor+1):Math.round(x))/scale;}
export function parsePay(source){if(!source)return null;
  const num=String.raw`\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kK](?![A-Za-z]))?`;
  const range=new RegExp(num+String.raw`\s*(?:-|–|—|to)\s*`+num+String.raw`\s*(USD|CAD|EUR|GBP|INR)?\s*(per hour|/\s*hr|/\s*hour|hourly|an hour|per year|/\s*yr|/\s*year|annually|annual|a year|per annum|per month|monthly)?`,'gi');
  for(const m of source.matchAll(range)){
    const number=(s,k)=>Number(s.replaceAll(',',''))*(k?1000:1);let low=number(m[1],m[2]),high=number(m[3],m[4]);if(low>high)[low,high]=[high,low];
    const window=source.slice(Math.max(0,m.index-160),m.index+m[0].length+20);const currency=(m[5]||((m[0].includes('$')||window.includes('USD'))?'USD':'' )).toUpperCase()||null;
    const unit=(m[6]||'').toLowerCase();const flags=[];if(!unit)flags.push('inferred_pay_period');if(!currency)flags.push('unknown_currency');
    const period=unit.includes('hour')||unit.includes('hr')?'hour':unit.includes('month')?'month':unit?'year':high<300?'hour':'year';const mult={hour:2080,month:12,year:1}[period];
    if(period==='hour'&&!(low>=7&&low<=500)||period==='year'&&!(low>=15000&&low<=3000000))continue;
    if(high*mult>3000000||(low&&high/low>10))flags.push('suspicious_range');
    return {low,high,currency,period,annualLow:pyRound(low*mult),annualHigh:pyRound(high*mult),flags};
  }return null;
}
export function validatedPay(input){if(!input)return null;let{low,high,currency,period,annualLow,annualHigh}=input;const flags=[...(input.flags||[])];const numbers=[low,high,annualLow,annualHigh];const validNumber=v=>v==null||typeof v==='number'&&Number.isFinite(v)&&v>=0;
  if(!numbers.every(validNumber)){flags.push('invalid_numeric_pay');[low,high,annualLow,annualHigh]=numbers.map(v=>validNumber(v)?v:null);}
  if(!['hour','month','year'].includes(period))flags.push('unknown_pay_period');if(typeof currency!=='string'||!/^[A-Za-z]{3}$/.test(currency))flags.push('unknown_currency');
  if(annualHigh!=null&&annualHigh>1000000)flags.push('suspicious_annual_max');if(low!=null&&high!=null&&low>high)flags.push('inverted_range');if(annualLow!=null&&annualHigh!=null&&annualLow>annualHigh)flags.push('inverted_annual_range');
  const valid=!flags.length&&currency!=null&&period!=null&&annualLow!=null&&annualHigh!=null;
  return {low,high,currency,period,annualLow:valid?annualLow:null,annualHigh:valid?annualHigh:null,valid,flags:unique(flags)};
}
export function upstreamRecord(row,extra,{commit=PIN,asOf=AS_OF}={}){
  const source='upstream:'+commit;let pay=validatedPay(parsePay(text(row.Pay)));const flags=[];
  if(pay&&row.Pay.includes('$'))pay={...pay,currency:null,annualLow:null,annualHigh:null,valid:false,flags:unique([...pay.flags,'ambiguous_csv_currency'])};
  if(pay&&extra){const digits=pay.period==='hour'?2:0;const bounds=[['pay_lo','low'],['pay_hi','high']].every(([k,f])=>typeof extra[k]==='number'&&Number.isFinite(extra[k])&&pyRound(extra[k],digits)===pay[f]);
    if(bounds&&extra.pay_period===pay.period){const mult={hour:2080,month:12,year:1}[pay.period];pay=validatedPay({...pay,currency:extra.pay_cur,annualLow:mult?pay.low*mult:null,annualHigh:mult?pay.high*mult:null,flags:pay.flags.filter(f=>!['ambiguous_csv_currency','unknown_currency'].includes(f))});if(!extra.pay_cur)pay.flags=unique([...pay.flags,'ambiguous_csv_currency']);flags.push('typed_currency_reported');}
    else pay={...pay,valid:false,annualLow:null,annualHigh:null,flags:unique([...pay.flags,'typed_pay_mismatch'])};
  }
  const loc={country:text(row.Country),region:text(row.State),city:text(row.City),precision:text(row.City)?'city':text(row.State)?'region':text(row.Country)?'country':'unknown',primary:true};let arrangement=text(row['Work arrangement']);if(!['Remote','Hybrid','On-site',null].includes(arrangement)){arrangement=null;flags.push('unknown_arrangement');}
  flags.push('upstream_reported','unknown_text_coverage');if(pay?.flags.length)flags.push(...pay.flags);
  return {id:row['Posting ID'],companyId:row.Ticker,title:row.Title,sourceUrl:safeUrl(row.URL),occupationId:text(row['SOC code']),level:text(row['Job level']),employmentType:text(row['Job type']),arrangement,degree:text(row['Minimum degree']),equivalentExperience:row['Accepts equivalent experience']==='Yes'?true:null,experienceYears:row['Years of experience']?Number(row['Years of experience']):null,locations:[loc],skillIds:unique(row.Skills.split(';').map(s=>s.trim()).filter(Boolean).map(s=>stableId('skill',s))),licenseIds:unique(row['Licenses and certifications'].split(';').map(s=>s.trim()).filter(Boolean).map(s=>stableId('license',s))),pay,sourcePostedDate:text(row.Posted),dateBasis:text(row.Posted)?'upstream_normalized':'unknown',firstObservedAt:null,lastObservedAt:null,hasDescription:null,availability:{Open:'upstream_reported_open',Closed:'closed','Possibly closed':'possibly_closed',Unverified:'unverified'}[row.Status],availabilityAsOf:asOf,availabilitySourceId:source,sourceIds:[source],fieldProvenance:{},quality:{completeness:'unknown',flags,conflictGroups:[]},provenance:Object.fromEntries(['status','date','location','pay','skills','qualifications'].map(k=>[k,source]))};
}
const groups={status:['availability','availabilityAsOf','availabilitySourceId'],date:['sourcePostedDate','dateBasis'],location:['locations'],pay:['pay'],skills:['skillIds','licenseIds'],qualifications:['occupationId','level','employmentType','arrangement','degree','equivalentExperience','experienceYears']};
export function usable(value){if(Array.isArray(value)&&value.length&&typeof value[0]==='object'&&'precision'in value[0])return value.some(l=>l.country||l.region||l.city);return value!=null&&value!==''&&(!Array.isArray(value)||value.length>0);}
export function mergeRecords(upstream,local){if(upstream.id!==local.id)throw Error('Identity mismatch');const [preferred,other]=(local.availabilityAsOf||'').slice(0,10)>=(upstream.availabilityAsOf||'').slice(0,10)?[local,upstream]:[upstream,local];const result=structuredClone(preferred);result.sourceIds=unique([...upstream.sourceIds,...local.sourceIds]);result.firstObservedAt=local.firstObservedAt;result.lastObservedAt=local.lastObservedAt;const conflicts=[];
  for(const [group,fields]of Object.entries(groups)){const content=fields.filter(f=>!['dateBasis','availabilityAsOf','availabilitySourceId'].includes(f));let selected=preferred;if(!content.some(f=>usable(preferred[f]))&&content.some(f=>usable(other[f])))selected=other;for(const f of fields)result[f]=structuredClone(selected[f]);result.provenance[group]=selected.provenance[group];if(group==='qualifications')for(const f of fields)if(!usable(result[f])&&usable(other[f])){result[f]=structuredClone(other[f]);result.fieldProvenance[f]=other.provenance[group];}
    if(content.some(f=>usable(upstream[f])&&usable(local[f])&&canonical(upstream[f])!==canonical(local[f])))conflicts.push(group);
  }
  result.hasDescription=result.provenance.skills.startsWith('local:')?local.hasDescription:null;result.quality={completeness:result.availabilitySourceId.startsWith('local:')?local.quality.completeness:'unknown',flags:unique([...preferred.quality.flags,...other.quality.flags]),conflictGroups:conflicts};return result;
}
export async function loadOriginal(directory=INTAKE){
  const seed=validateSeed(JSON.parse(await readFile(new URL('../store/local-seed.json',import.meta.url),'utf8')));const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));if(report.dryRun||report.commit!==PIN)throw Error('Original intake is not admitted at audited pin');
  const postings=parseCsv(await readVerified(join(directory,'Job postings.csv'),HASHES['Job postings.csv']),'postings');const companies=parseCsv(await readVerified(join(directory,'data source.csv'),HASHES['data source.csv']),'companies');
  if(postings.rejects.length||companies.rejects.length)throw Error('Pinned audit expects zero rejected rows');let typed=new Map();if(report.typedSupplement?.status==='accepted')typed=decodeSupplement(await readVerified(join(directory,'index.html'),HASHES['index.html']),postings.rows);
  const upstream=postings.rows.map(row=>upstreamRecord(row,typed.get(row['Posting ID'])));const local=seed.localPostings;const upMap=new Map(upstream.map(r=>[r.id,r]));const localMap=new Map(local.map(r=>[r.id,r]));const combined=[...new Set([...upMap.keys(),...localMap.keys()])].sort().map(id=>upMap.has(id)&&localMap.has(id)?mergeRecords(upMap.get(id),localMap.get(id)):upMap.get(id)||localMap.get(id));
  return {modes:{combined,upstream:upstream.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),local},catalog:seed.catalog,asOf:AS_OF,methods:{...seed.methods,pay:typed.size?'csv-audited-typed-currency-1':'validated-csv-currency-unknown-1'},limitations:seed.limitations,sourceDatasetVersion:SOURCE_VERSION};
}
