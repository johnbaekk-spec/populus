import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderParitySurfaces } from './lib/ui-parity-surfaces.ts';
import { unavailableDesignPanel } from '../src/lib/ui/index.ts';
import { feedHeadHtml, txnRowHtml, type TxnRow } from '../src/lib/format.ts';
import { MiniElement } from './lib/mini-dom.ts';
import { domOf } from './lib/ledger-dom.ts';

test('R16: member bands read identity → chart → tickers ranked → transactions → signals; the empty annual/overlap frames are ONE planned line', async () => {
  const html = (await renderParitySurfaces()).memberBody!;
  const titles = ['Disclosed flow by quarter', 'Net disclosed flow by ticker', 'Trading profile', 'All disclosed transactions', 'Filing history'];
  let previous = -1;
  for (const title of titles) {
    const at = html.indexOf(`>${title}</h2>`);
    assert.ok(at > previous, `${title} must be present in source reading order`);
    previous = at;
  }
  for (const gone of ['Holdings from annual disclosure', 'Reconciliation', 'Institutional overlap']) {
    assert.ok(!html.includes(`>${gone}</h2>`), `${gone} is no longer a frame on the page`);
  }
  assert.doesNotMatch(html, /annual records unavailable|join unavailable/, 'no em-dash stat tiles remain');
  assert.equal((html.match(/class="planned-line"/g) ?? []).length, 1, 'exactly one planned line');
  assert.match(html, /planned-line"><span class="badge-planned">PLANNED<\/span> annual holdings · 13F overlap</);
  // the honesty fold: the relocated explainer is still on the page
  assert.match(html, /Annual holdings are not in this view/);
});

/* DESIGN-POLISH M2 (T2.3; Architecture F, the member composition). The page
   reads chart → band M1 (net flow │ trading profile) → all transactions →
   band M2 (filing history │ signals) → paper filings → the ONE Planned line →
   the collapsed context disclosures, in DOM order (= visual order). Band M2
   collapses EXACTLY when its Signals cell is only an empty-state line (R10):
   collapsed on purpose, it says so with `data-collapsed="empty-state"`, and the
   empty line sits under the history; with signal rows it is a real pair. */
function memberBandOrder(html: string): string[] {
  const root = domOf(html);
  const mark = (el: MiniElement): string | null =>
    el.classList.contains('design-member-chart') ? 'chart'
      : el.classList.contains('design-flow-band') ? 'M1'
        : el.getAttribute('aria-labelledby') === 'txns-h' ? 'transactions'
          : el.classList.contains('design-member-history-band') ? 'M2'
            : el.classList.contains('paper-block') ? 'paper'
              : el.classList.contains('planned-line') ? 'planned'
                : el.tagName === 'details' && /Recent disclosures and committee context/.test(el.textContent) ? 'context'
                  : el.tagName === 'details' && /Additional disclosure analysis/.test(el.textContent) ? 'analysis'
                    : null;
  return root.children.map(mark).filter((m): m is string => m !== null);
}

test('T2.3: member bands read chart → M1 → transactions → M2 → paper → Planned line → context; band M2 collapses exactly when Signals is an empty state', async () => {
  const { memberBody, memberSignalsPanel } = await import('../src/lib/ui/index.ts');
  const stamps = { buildId: 'b', generatedAt: '2026-07-24 06:56 UTC', generatedAtDate: '2026-07-24' };
  const ctx = { watched: new Set<string>() };
  const row = (i: number, over: Partial<TxnRow> = {}): TxnRow => ({ kind:'txn', txnId:`t${i}`, bioguide:'T000001', name:'Fixture Member', party:'R', state:'OK', district:null, chamber:'senate', ticker:'WMB', asset:'Williams', assetType:null, side:'purchase', owner:'self', low:1001, high:15000, traded:'2026-06-24', filed:`2026-07-${String(10 + i).padStart(2, '0')}`, lag:20, late:0, flags:[], doc:`https://efdsearch.senate.gov/x/${i}`, ...over });
  const member = { bioguide:'T000001', name:'Fixture Member', party:'R', state:'OK', district:null, chamber:'senate', servingSince:'1999', filingCount:4, txns:[row(1), row(2, { side:'sale', ticker:'NVDA' })], paper:[{ kind:'paper', filed:'2026-06-01', name:'Fixture Member', bioguide:'T000001', party:'R', state:'OK', district:null, chamber:'senate', doc:'https://efdsearch.senate.gov/p' }] } as never;
  const deps = { resolveSector: null, sectorMeta: null, committees: null };
  const artifact = { v:1, buildId:'b', computedAt:'2026-07-24', thresholdVersion:'1', retentionDays:90, coverageFrom:'2026-04-25', coverageTo:'2026-07-24', lifecycleNote:'n', compaction:'none', dateAnomaliesExcluded:0, lagCaveat:'c', withheld:[],
    signals:[{ id:'s1-large:a', kind:'s1-large', rule:'r', thresholdVersion:'1', entities:{ bioguide:'T000001', memberName:'Fixture Member', ticker:'WMB' }, magnitude:{ low:250001, high:500000 }, receipts:['https://efdsearch.senate.gov/x'], occurrence:{ tradeDate:'2026-06-24', filedDate:'2026-07-11' }, sourceAvailableAt:'2026-07-11', computedAt:'2026-07-24', firstSeenBuild:'b', lastSeenBuild:'b', status:'active', cohort:'senate' }] } as never;
  const withRows = memberSignalsPanel(artifact, 'T000001', ctx);
  const emptyState = memberSignalsPanel(artifact, 'Z999999', ctx);

  const expected = ['chart', 'M1', 'transactions', 'M2', 'paper', 'planned', 'context', 'analysis'];
  for (const signals of [withRows, emptyState, '']) {
    assert.deepEqual(memberBandOrder(memberBody(member, stamps, ctx, 0, deps, signals)), expected);
  }
  const bandOf = (signals: string): MiniElement => domOf(memberBody(member, stamps, ctx, 0, deps, signals)).querySelector('.design-member-history-band')!;
  /** R10: collapsed ⇔ the Signals cell is an empty state; a real pair holds both cells as a `.design-pair`. */
  const pairProblems = (band: MiniElement): string[] => {
    const out: string[] = [];
    const signalsCell = band.children.find((c) => c.getAttribute('aria-label') === 'Signals');
    if (!signalsCell) return ['band M2 has no Signals cell'];
    const collapsed = band.getAttribute('data-collapsed') === 'empty-state';
    if (collapsed !== signalsCell.hasAttribute('data-empty-state')) out.push(`collapsed=${collapsed} but the Signals cell ${signalsCell.hasAttribute('data-empty-state') ? 'is' : 'is not'} an empty state`);
    if (!band.classList.contains('design-pair')) out.push('band M2 is not a .design-pair');
    if (band.children[0]!.getAttribute('aria-label') !== 'Filing history') out.push('the history leads the band');
    return out;
  };
  const paired = bandOf(withRows);
  assert.deepEqual(pairProblems(paired), []);
  assert.equal(paired.getAttribute('data-collapsed'), null, 'signal rows: a real two-cell pair');
  const collapsed = bandOf(emptyState);
  assert.deepEqual(pairProblems(collapsed), []);
  assert.equal(collapsed.getAttribute('data-collapsed'), 'empty-state', 'an empty-state Signals cell collapses the pair');
  assert.equal(bandOf('').getAttribute('data-collapsed'), 'empty-state', 'the unjoined (/e/) Signals line is an empty state too');
  // controls: the lost pair (no data-collapsed over an empty cell) and a pair collapsed over real rows each fail
  const lost = domOf(memberBody(member, stamps, ctx, 0, deps, emptyState).replace(' data-collapsed="empty-state"', '')).querySelector('.design-member-history-band')!;
  assert.ok(pairProblems(lost).length > 0, 'control: an empty-state cell left uncollapsed');
  const forced = domOf(memberBody(member, stamps, ctx, 0, deps, withRows).replace('class="design-band design-pair design-member-history-band"', 'class="design-band design-pair design-member-history-band" data-collapsed="empty-state"')).querySelector('.design-member-history-band')!;
  assert.ok(pairProblems(forced).length > 0, 'control: a collapse over signal rows');
  // control: the reading order detector sees a band moved out of place
  const html = memberBody(member, stamps, ctx, 0, deps, withRows);
  const planned = html.indexOf('<p class="planned-line">');
  const paper = html.indexOf('<section class="paper-block"');
  assert.notDeepEqual(memberBandOrder(html.slice(0, paper) + html.slice(planned, html.indexOf('</p>', planned) + 4) + html.slice(paper, planned) + html.slice(html.indexOf('</p>', planned) + 4)), expected, 'control: the Planned line above the paper filings');
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
