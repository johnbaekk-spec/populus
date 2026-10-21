import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderParitySurfaces } from './lib/ui-parity-surfaces.ts';
import { unavailableDesignPanel } from '../src/lib/ui/index.ts';
import { feedHeadHtml, txnRowHtml, type TxnRow } from '../src/lib/format.ts';
import { MiniElement } from './lib/mini-dom.ts';
import { domOf } from './lib/ledger-dom.ts';

/* launch M4b (R23, R26; LD24) — replaces the DESIGN-POLISH M2 composition
   pins (R16 band order, T2.3 band M2), whose bands the approved launch layout
   retires. The property kept: the member page reads in ONE stated order, in
   DOM order (= visual order), with nothing honest lost and no empty frame.
   The mechanism: an ACTIVE member (4+ trades) reads chart → trades in the main
   column, then the side column (Top tickers, Profile at 10+, Sectors at 2+,
   Signals), then Filing history (2+ filings), paper filings and the collapsed
   committee context; the Planned strip and "Additional disclosure analysis"
   are gone (member-18, member-21). */
function memberOrder(html: string): string[] {
  const root = domOf(html);
  const out: string[] = [];
  const walk = (el: MiniElement): void => {
    const mark =
      el.classList.contains('design-member-chart') ? 'chart'
        : el.getAttribute('aria-labelledby') === 'txns-h' ? 'trades'
          : el.classList.contains('member-top-tickers') ? 'top'
            : el.getAttribute('aria-label') === 'Profile' ? 'profile'
              : el.classList.contains('member-sectors') || el.classList.contains('design-unavailable-line') ? 'sectors'
                : el.getAttribute('aria-label') === 'Signals' ? 'signals'
                  : el.getAttribute('aria-label') === 'Filing history' ? 'history'
                    : el.classList.contains('paper-block') ? 'paper'
                      : el.classList.contains('planned-line') ? 'planned'
                        : el.tagName === 'details' && /Recent disclosures and committee context/.test(el.textContent) ? 'context'
                          : el.tagName === 'details' && /Additional disclosure analysis/.test(el.textContent) ? 'analysis'
                            : el.classList.contains('member-compact') ? 'compact'
                              : null;
    if (mark) out.push(mark);
    else el.children.forEach(walk);
  };
  root.children.forEach(walk);
  return out;
}

const STAMPS = { buildId: 'b', generatedAt: '2026-07-24 06:56 UTC', generatedAtDate: '2026-07-24' };
const row = (i: number, over: Partial<TxnRow> = {}): TxnRow => ({ kind:'txn', txnId:`t${i}`, bioguide:'T000001', name:'Fixture Member', party:'R', state:'OK', district:null, chamber:'senate', ticker:'WMB', asset:'Williams', assetType:null, side:'purchase', owner:'self', low:1001, high:15000, traded:'2026-06-24', filed:`2026-07-${String(10 + i).padStart(2, '0')}`, lag:20, late:0, flags:[], doc:`https://efdsearch.senate.gov/x/${i}`, ...over });
const PAPER = [{ kind:'paper', filed:'2026-06-01', name:'Fixture Member', bioguide:'T000001', party:'R', state:'OK', district:null, chamber:'senate', doc:'https://efdsearch.senate.gov/p' }];
const memberOf = (n: number): never => ({ bioguide:'T000001', name:'Fixture Member', party:'R', state:'OK', district:null, chamber:'senate', servingSince:'1999', filingCount:n + 1, txns: Array.from({ length: n }, (_, i) => row(i, { ticker: i % 2 ? 'NVDA' : 'WMB', side: i % 3 ? 'purchase' : 'sale' })), paper: PAPER }) as never;
const SECTORS = { resolveSector: (t: string) => ({ state: 'sector' as const, sector: t === 'WMB' ? 'energy' : 'manufacturing' }), sectorMeta: { taxonomyVersion: '1', asOf: '2026-07-01' }, committees: null };

test('R23: an active member reads chart → trades → Top tickers → Profile → Sectors → Signals → history → paper → context; no Planned strip, no analysis drawer', async () => {
  const { memberBody } = await import('../src/lib/ui/index.ts');
  const ten = memberBody(memberOf(10), STAMPS, {}, 0, SECTORS, '');
  assert.deepEqual(memberOrder(ten), ['chart', 'trades', 'top', 'profile', 'sectors', 'signals', 'history', 'paper', 'context']);
  assert.ok(!ten.includes('class="planned-line"'), 'member-18: no PLANNED strip');
  assert.ok(!/Additional disclosure analysis/.test(ten), 'member-21: no analysis drawer');
  // the thresholds: Profile only at 10+ trades; a member at 4..9 has none
  const four = memberBody(memberOf(4), STAMPS, {}, 0, SECTORS, '');
  assert.deepEqual(memberOrder(four), ['chart', 'trades', 'top', 'sectors', 'signals', 'history', 'paper', 'context']);
  // control: the detector sees a section moved out of place
  const moved = ten.replace(/<section class="paper-block"[\s\S]*?<\/section>/, '');
  assert.notDeepEqual(memberOrder(moved), memberOrder(ten), 'control: a missing section changes the order');
});

test('R23: three or fewer trades read as the compact layout, then paper; the boundary is four', async () => {
  const { memberBody } = await import('../src/lib/ui/index.ts');
  for (const n of [0, 1, 3]) assert.deepEqual(memberOrder(memberBody(memberOf(n), STAMPS, {}, 0, SECTORS, '')), ['compact', 'paper'], `${n} trades: compact`);
  assert.equal(memberOrder(memberBody(memberOf(4), STAMPS, {}, 0, SECTORS, ''))[0], 'chart', '4 trades: active');
});

test('reference feed keeps eight matching columns, unknown amount, owner and both dates', () => {
  const row = { kind:'txn', txnId:'design', bioguide:'T000001', name:'Test Member', party:'I', state:'VT', district:null, chamber:'senate', ticker:null, asset:'<Unknown asset>', assetType:null, side:'purchase', owner:'joint', low:null, high:null, traded:'2026-01-01', filed:'2026-02-01', lag:31, late:0, flags:[], doc:'https://example.org/receipt' } as TxnRow;
  const html = txnRowHtml(row, {});
  assert.equal((html.match(/<td\b/g) ?? []).length, 8);
  assert.equal((feedHeadHtml({ notes:{ scope:'congress-feed' } }).match(/<th\b/g) ?? []).length, 8);
  assert.match(html,/&lt;Unknown asset&gt;/);
  assert.match(html,/Member <\/span>/);
  assert.match(html,/2026-02-01/);
  assert.match(html,/2026-01-01/);
  assert.match(html,/JT/);
  assert.match(html,/https:\/\/example.org\/receipt/);
  assert.doesNotMatch(html,/\$0/);
});

test('R24: an unavailable surface is one stated line (no empty frame) and escapes all supplied content', () => {
  const html = unavailableDesignPanel('<Title>', '<period>', ['<Column>', 'Value'], '<Missing>');
  assert.match(html, /&lt;Title&gt;/);
  assert.match(html, /&lt;Missing&gt;/, 'the reason is still stated');
  assert.match(html, /not available in this build/);
  assert.doesNotMatch(html, /<Missing>|<Column>|<table/);
});

/* The weight property is unchanged — a filer weight is stated only over a
   complete, fully valued book. DESIGN-POLISH M2 (T2.1, R12, Architecture D)
   changed the COLUMN SET: the derived Kind, Position change and Congress
   columns are removed outright, and Ticker, Weight and Wt render by presence,
   so the pinned `9` headers became the table's own `data-columns` set. When
   the book is incomplete the weight columns are REMOVED (not left empty) and
   the table foot prints why. */
test('filer weight requires a complete, fully valued book', async () => {
  const {holdingsTableHtml} = await import('../src/lib/holdings.ts');
  const {parseDataColumns} = await import('../src/lib/format.ts');
  const row = {cik:'1', period:'2026-03-31', filing_key:null, security_id:null, cusip:null, issuer_name:'Example', title_of_class:null, value_usd:2000, shares:10, ssh_type:'SH', put_call:null, position_key:null, flags:[]} as never;
  const opts = {cik:'1', filerName:'Example', period:'2026-03-31', rows:[row, {...row as object, value_usd:1000} as never], filings:{}, page:0, reference:true};
  const cols = (html: string): string[] => parseDataColumns(/data-columns="([^"]*)"/.exec(html)?.[1]) ?? [];
  const heads = (html: string): string[] => [...html.matchAll(/<th\b[^>]*data-col="([^"]+)"/g)].map((m) => m[1]!);
  const reason = (html: string): string => /<p class="table-foot-reason">([^<]*)<\/p>/.exec(html)?.[1] ?? '';
  const full = holdingsTableHtml(opts);
  assert.match(full,/66\.7%/);
  assert.deepEqual(cols(full), ['issuer','weight','value','shares-unit','wt'], 'a complete book keeps both weight columns');
  assert.deepEqual(heads(full), cols(full), 'every rendered header is a listed column, in order');
  assert.equal((full.match(/<th\b/g) ?? []).length, cols(full).length);
  for (const gone of ['Kind', 'Position change', 'Congress']) assert.doesNotMatch(full, new RegExp(`<th\\b[^>]*>(?:<[^>]+>)*${gone}<`), `the derived ${gone} column is removed`);
  assert.match(reason(full), /Change kind and share change are in Position changes above; Congress overlap is planned\./, 'the removed derived columns are accounted for in the foot');
  for (const partial of [holdingsTableHtml({...opts,totalRows:3}), holdingsTableHtml({...opts,rows:[row,{...row as object,value_usd:null} as never]})]) {
    assert.doesNotMatch(partial,/66\.7%/);
    assert.ok(!cols(partial).includes('weight') && !cols(partial).includes('wt'), 'an incomplete book removes the weight columns');
    assert.match(reason(partial), /Weight: shown only when every reported row is embedded and carries a disclosed value\./, '…and says why');
  }
  // control: a complete book states no weight reason
  assert.doesNotMatch(reason(full), /Weight:/);
});

test('design label exemption cannot exempt unsupported analytical claims', async () => {
  const {redactFiledNames, BANNED_PATTERNS} = await import('./lib/banned-scan.ts');
  const pattern = BANNED_PATTERNS.find(p=>p.name==='conviction')!.re;
  assert.equal(pattern.test(redactFiledNames('<h2 class="section-h">Conviction leaders</h2>')),false);
  assert.equal(pattern.test(redactFiledNames('<p>This manager has high conviction.</p>')),true);
});


test('fifty-row feed paging (R12) retains every transaction and trailing paper filing', async () => {
  const {pageSlice, pageCountFor, feedCountText, DESIGN_FEED_PAGE_SIZE} = await import('../src/lib/format.ts');
  assert.equal(DESIGN_FEED_PAGE_SIZE, 50);
  const rows = Array.from({length:100}, (_,i) => ({kind:'txn',txnId:String(i)})) as any[];
  rows.push({kind:'paper',doc:'trailing'});
  const pages = Array.from({length:pageCountFor(rows,DESIGN_FEED_PAGE_SIZE)}, (_,page)=>pageSlice(rows,page,DESIGN_FEED_PAGE_SIZE));
  assert.deepEqual(pages.map(p=>p.length), [50,50,1]);
  assert.deepEqual(pages.flat(),rows);
  assert.match(feedCountText({page:1,pageSize:50,txnMatched:100,paperMatched:1,txnOnPage:50,paperOnPage:0,txnTotal:100,indeterminate:0}),/^51–100/);
});

test('reference ticker ranks keep count bars and distinct member totals on sort repaint', async () => {
  const {congressTickersRollup} = await import('../src/lib/derive.ts');
  const {rankingRootHtml} = await import('../src/lib/ui/rankings.ts');
  const base = {kind:'txn',ticker:'ABC',name:'Member',party:'I',chamber:'house',side:'purchase',low:1000,high:15000,filed:'2026-07-01',traded:'2026-06-30',late:0,flags:[]} as any;
  const rollup = congressTickersRollup([{...base,bioguide:'A'},{...base,bioguide:'A'},{...base,bioguide:'B'},{...base,bioguide:null}], '2026-08-02');
  assert.equal(rollup.rows[0]!.memberCount,2);
  for (const dir of ['asc','desc'] as const) {
    const html=rankingRootHtml(rollup.rows,'txns',dir,'tickers',{referenceRankings:true}).html;
    assert.equal((html.match(/<td\b/g)??[]).length,6);
    assert.match(html,/4 buys; 0 sells/);
    assert.match(html,/<td class="c-num">2<\/td>/);
  }
});


test('provable net display cannot round a guarantee away from zero', async () => {
  const {rankingRowsHtml} = await import('../src/lib/ui/rankings.ts');
  const base = {id:'ABC',bioguide:null,name:'ABC',party:'',chamber:'house',txns:1,buys:1,sells:0,memberCount:1} as any;
  const ctx = {referenceRankings:true};
  const positive = rankingRowsHtml([{...base,net:{kind:'finite',low:9_090_000,high:15_000_000}}],'tickers',ctx);
  assert.match(positive,/≥ \$9\.0M/);
  assert.doesNotMatch(positive,/≥ \$9\.1M/);
  const negative = rankingRowsHtml([{...base,net:{kind:'finite',low:-15_000_000,high:-9_090_000}}],'tickers',ctx);
  assert.match(negative,/≤ −\$9\.0M/);
  assert.doesNotMatch(negative,/≤ −\$9\.1M/);
});
