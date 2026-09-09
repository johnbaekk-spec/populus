import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderParitySurfaces } from './lib/ui-parity-surfaces.ts';
import { unavailableDesignPanel } from '../src/lib/ui/index.ts';
import { feedHeadHtml, txnRowHtml, type TxnRow } from '../src/lib/format.ts';

test('reference member bands remain in reading order even without annual and overlap data', async () => {
  const html = (await renderParitySurfaces()).memberBody!;
  const titles = ['Holdings from annual disclosure', 'Reconciliation', 'Net disclosed flow by ticker', 'Trading profile', 'All disclosed transactions', 'Filing history', 'Institutional overlap'];
  let previous = -1;
  for (const title of titles) {
    const at = html.indexOf(`>${title}</h2>`);
    assert.ok(at > previous, `${title} must be present in source reading order`);
    previous = at;
  }
  assert.match(html, /annual financial-disclosure|Annual financial-disclosure/);
  assert.match(html, /annual records unavailable/);
});

test('reference feed keeps eight matching columns, unknown amount, owner and both dates', () => {
  const row = { kind:'txn', txnId:'design', bioguide:'T000001', name:'Test Member', party:'I', state:'VT', district:null, chamber:'senate', ticker:null, asset:'<Unknown asset>', assetType:null, side:'purchase', owner:'joint', low:null, high:null, traded:'2026-01-01', filed:'2026-02-01', lag:31, late:0, flags:[], doc:'https://example.org/receipt' } as TxnRow;
  const html = txnRowHtml(row, { watched:new Set(), referenceFeed:true });
  assert.equal((html.match(/<td\b/g) ?? []).length, 8);
  assert.equal((feedHeadHtml({referenceFeed:true}).match(/<th\b/g) ?? []).length, 8);
  assert.match(html,/&lt;Unknown asset&gt;/);
  assert.match(html,/Member <\/span>/);
  assert.match(html,/2026-02-01/);
  assert.match(html,/2026-01-01/);
  assert.match(html,/JT/);
  assert.match(html,/https:\/\/example.org\/receipt/);
  assert.doesNotMatch(html,/\$0/);
});

test('unavailable panels retain table semantics and escape all supplied content', () => {
  const html = unavailableDesignPanel('<Title>', '<period>', ['<Column>', 'Value'], '<Missing>');
  assert.match(html, /&lt;Title&gt;/);
  assert.match(html, /&lt;Missing&gt;/);
  assert.match(html, /colspan="2"/);
  assert.match(html, /Not available in this build/);
  assert.doesNotMatch(html, /<Missing>|<Column>/);
});

test('filer weight requires a complete, fully valued book', async () => {
  const {holdingsTableHtml} = await import('../src/lib/holdings.ts');
  const row = {cik:'1', period:'2026-03-31', filing_key:null, security_id:null, cusip:null, issuer_name:'Example', title_of_class:null, value_usd:2000, shares:10, ssh_type:'SH', put_call:null, position_key:null, flags:[]} as never;
  const opts = {cik:'1', filerName:'Example', period:'2026-03-31', rows:[row, {...row as object, value_usd:1000} as never], filings:{}, page:0, reference:true};
  const full = holdingsTableHtml(opts);
  assert.match(full,/66\.7%/);
  assert.equal((full.match(/<th\b/g) ?? []).length,9);
  assert.doesNotMatch(holdingsTableHtml({...opts,totalRows:3}),/66\.7%/);
  assert.doesNotMatch(holdingsTableHtml({...opts,rows:[row,{...row as object,value_usd:null} as never]}),/66\.7%/);
});

test('design label exemption cannot exempt unsupported analytical claims', async () => {
  const {redactFiledNames, BANNED_PATTERNS} = await import('./lib/banned-scan.ts');
  const pattern = BANNED_PATTERNS.find(p=>p.name==='conviction')!.re;
  assert.equal(pattern.test(redactFiledNames('<h2 class="section-h">Conviction leaders</h2>')),false);
  assert.equal(pattern.test(redactFiledNames('<p>This manager has high conviction.</p>')),true);
});


test('eight-row feed paging retains every transaction and trailing paper filing', async () => {
  const {pageSlice, pageCountFor, feedCountText, DESIGN_FEED_PAGE_SIZE} = await import('../src/lib/format.ts');
  const rows = Array.from({length:16}, (_,i) => ({kind:'txn',txnId:String(i)})) as any[];
  rows.push({kind:'paper',doc:'trailing'});
  const pages = Array.from({length:pageCountFor(rows,DESIGN_FEED_PAGE_SIZE)}, (_,page)=>pageSlice(rows,page,DESIGN_FEED_PAGE_SIZE));
  assert.deepEqual(pages.map(p=>p.length), [8,8,1]);
  assert.deepEqual(pages.flat(),rows);
  assert.match(feedCountText({page:1,pageSize:8,txnMatched:16,paperMatched:1,txnOnPage:8,paperOnPage:0,txnTotal:16,indeterminate:0}),/^9–16/);
});

test('reference ticker ranks keep count bars and distinct member totals on sort repaint', async () => {
  const {congressTickersRollup} = await import('../src/lib/derive.ts');
  const {rankingRootHtml} = await import('../src/lib/ui/rankings.ts');
  const base = {kind:'txn',ticker:'ABC',name:'Member',party:'I',chamber:'house',side:'purchase',low:1000,high:15000,filed:'2026-07-01',traded:'2026-06-30',late:0,flags:[]} as any;
  const rollup = congressTickersRollup([{...base,bioguide:'A'},{...base,bioguide:'A'},{...base,bioguide:'B'},{...base,bioguide:null}], '2026-08-02');
  assert.equal(rollup.rows[0]!.memberCount,2);
  for (const dir of ['asc','desc'] as const) {
    const html=rankingRootHtml(rollup.rows,'txns',dir,'tickers',{watched:new Set(),referenceRankings:true}).html;
    assert.equal((html.match(/<td\b/g)??[]).length,6);
    assert.match(html,/4 buys; 0 sells/);
    assert.match(html,/<td class="c-num">2<\/td>/);
  }
});


test('provable net display cannot round a guarantee away from zero', async () => {
  const {rankingRowsHtml} = await import('../src/lib/ui/rankings.ts');
  const base = {id:'ABC',bioguide:null,name:'ABC',party:'',chamber:'house',txns:1,buys:1,sells:0,memberCount:1} as any;
  const ctx = {watched:new Set<string>(),referenceRankings:true};
  const positive = rankingRowsHtml([{...base,net:{kind:'finite',low:9_090_000,high:15_000_000}}],'tickers',ctx);
  assert.match(positive,/≥ \$9\.0M/);
  assert.doesNotMatch(positive,/≥ \$9\.1M/);
  const negative = rankingRowsHtml([{...base,net:{kind:'finite',low:-15_000_000,high:-9_090_000}}],'tickers',ctx);
  assert.match(negative,/≤ −\$9\.0M/);
  assert.doesNotMatch(negative,/≤ −\$9\.1M/);
});
