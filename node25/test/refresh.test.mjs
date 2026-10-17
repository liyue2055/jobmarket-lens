import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,sha,ROOT,PIN,AS_OF} from '../scripts/common.mjs';
import {POSTING_HEADERS} from '../scripts/import-upstream.mjs';
import {upstreamRecord} from '../scripts/original-source.mjs';
import {semanticIdentity,materialize} from '../scripts/materialize.mjs';
import {normalizeDeclaredCurrencyPay,loadCandidateRelease} from '../scripts/refresh-release.mjs';
const seed=JSON.parse(await readFile(join(ROOT,'store/local-seed.json'),'utf8'));
const row=(extra={})=>({...Object.fromEntries(POSTING_HEADERS.map(key=>[key,''])),
  'Posting ID':'NVDA:synthetic-refresh',Ticker:'NVDA',Title:'Synthetic release role',Status:'Open',
  URL:'https://example.test/job',...extra});

test('streamed semantic identity retains exact canonical hash and key-order stability',()=>{
  const data={modes:{upstream:[],combined:[{b:null,a:['a',2,true]}],local:[]},
    catalog:{companies:[]},methods:{merge:'synthetic'},asOf:'2026-10-16'};
  const expected=sha(canonical({modes:data.modes,catalog:data.catalog,methods:data.methods,asOf:data.asOf}));
  assert.equal(semanticIdentity(data),expected);
  assert.equal(semanticIdentity({...data,modes:{local:[],combined:[{a:['a',2,true],b:null}],upstream:[]}}),expected);
});
test('new upstream context changes only its source identity and timestamp; legacy defaults remain reproducible',()=>{
  const commit='2fc50364f3056b1dfa930e8dfeba576a5b28a3c8',asOf='2026-10-16T22:26:25Z';
  const legacy=upstreamRecord(row()),current=upstreamRecord(row(),undefined,{commit,asOf});
  assert.equal(legacy.availabilitySourceId,'upstream:'+PIN);assert.equal(legacy.availabilityAsOf,AS_OF);
  assert.equal(current.availabilitySourceId,'upstream:'+commit);assert.equal(current.availabilityAsOf,asOf);
  assert.deepEqual(new Set(Object.values(current.provenance)),new Set(['upstream:'+commit]));
  assert.equal(current.hasDescription,null);assert.equal(current.firstObservedAt,null);
});
test('explicit repeated currency labels normalize without dollar or country currency inference',()=>{
  const pay=normalizeDeclaredCurrencyPay('CAD 25–CAD 35 per hour');assert.equal(pay,'25 - 35 CAD per hour');
  const value=upstreamRecord(row({Pay:pay}),{pay_lo:25,pay_hi:35,pay_period:'hour',pay_cur:'CAD'});
  assert.equal(value.pay.currency,'CAD');assert.equal(value.pay.valid,true);
  assert.equal(value.pay.annualHigh,72800);
  assert.equal(normalizeDeclaredCurrencyPay('$25–$35 per hour'),'$25–$35 per hour');
  const unknown=upstreamRecord(row({Pay:'$25–$35 per hour',Country:'United States'}));
  assert.equal(unknown.pay.currency,null);assert.equal(unknown.pay.valid,false);
});
test('materialization cannot silently replace the retained sanitized local population',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lens-local-seed-check-'));
  try{const r=upstreamRecord(row());await assert.rejects(materialize({modes:{combined:[r],upstream:[r],local:[]},
    catalog:seed.catalog,localSeed:seed,asOf:seed.asOf,methods:seed.methods,sourceDatasetVersion:seed.sourceDatasetVersion},dir),/Local observations differ/);}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('unregistered source candidates fail before reading source bytes',async()=>{
  await assert.rejects(loadCandidateRelease({commit:'0'.repeat(40)}),/Unknown candidate/);
});
