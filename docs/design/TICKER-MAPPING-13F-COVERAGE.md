# Tier C 13F ticker mapping — coverage report

Generated 2026-09-11 06:29 UTC by `scripts/draft_ticker_mapping_13f.py promote` (R3, refinement 20260910).

- Drafted from the closed quarter **2026-03-31** (newest period in the source: 2026-06-30, refused as open).
- SEC company list snapshot sha256 `0ca03630819cec78bcdddd494732fec48a90b11a44305fa031e5353dc91d8775`.
- `verified_by`: claude-fable-5.1 developer agent, run refinement-20260910: ACCEPTED BY AUTOMATED RULE (see method); not reviewed individually

## Counts

| Population keys (closed quarter) | 214,771 |
|---|---|
| Target keys (top 2,000 by value ∪ notable-held) | 6,258 |
| … of which notable-held only (below the top cut) | 4,258 |
| Drafted candidates, population: single / multi-ticker / ambiguous / no-match | 45,979 / 10,549 / 81 / 158,162 |
| Drafted candidates, target: single / multi-ticker / ambiguous / no-match | 1,559 / 453 / 4 / 4,242 |
| **Verified rows shipped** | **1,531** |
| … by method exact-name / class-resolved / manual | 1,421 / 110 / 0 |
| Target rows left UNMAPPED (no ticker) | 4,727 |

## Dollar coverage

- Verified target value: $37,446,551,928,917 of $59,317,769,474,420 target value (**63.1%**).
- Verified target value as a share of the whole population value ($65,472,079,356,355): **57.2%**.

## Unmapped residue (target rows), by reason

| Reason | Rows | Value |
|---|---|---|
| no SEC issuer with this normalized name | 4,242 | $18,510,008,819,379 |
| issuer lists several tickers and no recorded class rule applies | 343 | $2,558,873,764,276 |
| class is not the issuer's common equity (or its ADR) | 138 | $777,753,539,570 |
| ambiguous identity: several SEC issuers share this normalized name | 4 | $24,581,422,278 |

## Largest unmapped target rows

| Issuer (filed) | Class | Value | Holders | Reason |
|---|---|---|---|---|
| STATE STR SPDR S&P 500 ETF T | TR UNIT | $884,468,897,383 | 3,398 | no SEC issuer with this normalized name |
| JPMORGAN CHASE & CO | COM | $512,597,714,557 | 4,133 | issuer lists several tickers and no recorded class rule applies |
| EXXON MOBIL CORP | COM | $429,352,042,175 | 4,067 | no SEC issuer with this normalized name |
| INVESCO QQQ TR | UNIT SER 1 | $423,695,526,288 | 3,144 | no SEC issuer with this normalized name |
| ISHARES TR | CORE S&P500 ETF | $413,557,258,394 | 3,087 | no SEC issuer with this normalized name |
| SPDR SERIES TRUST | STATE STREET SPD | $302,462,317,577 | 3,374 | no SEC issuer with this normalized name |
| VANGUARD INDEX FDS | S&P 500 ETF SHS | $242,609,061,375 | 2,984 | no SEC issuer with this normalized name |
| TAIWAN SEMICONDUCTOR MANUFAC | SPONSORED ADS | $235,572,528,945 | 2,295 | no SEC issuer with this normalized name |
| BANK AMERICA CORP | COM | $219,812,466,520 | 2,578 | no SEC issuer with this normalized name |
| SPDR GOLD TR | GOLD SHS | $218,054,809,434 | 2,505 | class is not the issuer's common equity (or its ADR) |
| GE AEROSPACE | COM NEW | $198,702,694,352 | 2,408 | no SEC issuer with this normalized name |
| CISCO SYS INC | COM | $197,044,784,638 | 2,819 | no SEC issuer with this normalized name |
| ISHARES TR | RUSSELL 2000 ETF | $195,270,461,524 | 2,051 | no SEC issuer with this normalized name |
| APPLIED MATLS INC | COM | $182,760,876,250 | 2,234 | no SEC issuer with this normalized name |
| GOLDMAN SACHS GROUP INC | COM | $182,729,918,835 | 2,429 | issuer lists several tickers and no recorded class rule applies |
| PHILIP MORRIS INTL INC | COM | $180,403,377,576 | 2,207 | no SEC issuer with this normalized name |
| WELLS FARGO & CO | COM | $165,216,458,499 | 2,130 | no SEC issuer with this normalized name |
| VANGUARD INDEX FDS | TOTAL STK MKT | $153,203,326,584 | 2,786 | no SEC issuer with this normalized name |
| TJX COS INC NEW | COM | $131,042,338,287 | 2,042 | no SEC issuer with this normalized name |
| AT&T INC | COM | $124,041,119,362 | 2,427 | issuer lists several tickers and no recorded class rule applies |
| INTERNATIONAL BUSINESS MACHS | COM | $122,859,762,215 | 2,576 | no SEC issuer with this normalized name |
| TEXAS INSTRS INC | COM | $120,050,278,054 | 1,816 | no SEC issuer with this normalized name |
| VANGUARD TAX-MANAGED FDS | VAN FTSE DEV MKT | $113,217,159,566 | 2,195 | no SEC issuer with this normalized name |
| ISHARES TR | CORE MSCI EAFE | $112,543,291,575 | 1,806 | no SEC issuer with this normalized name |
| UNION PAC CORP | COM | $104,463,137,980 | 2,057 | no SEC issuer with this normalized name |
| DISNEY WALT CO | COM | $101,587,744,972 | 2,245 | no SEC issuer with this normalized name |
| PROLOGIS INC. | COM | $101,184,873,496 | 1,324 | issuer lists several tickers and no recorded class rule applies |
| ISHARES INC | CORE MSCI EMKT | $98,100,088,404 | 1,748 | no SEC issuer with this normalized name |
| HONEYWELL INTL INC | COM | $95,721,295,167 | 2,125 | no SEC issuer with this normalized name |
| VERTEX PHARMACEUTICALS INC | COM | $94,306,226,310 | 1,371 | no SEC issuer with this normalized name |
| CHUBB LTD SWITZ | COM | $92,293,973,613 | 1,445 | no SEC issuer with this normalized name |
| ROYAL BK CDA | COM | $90,898,406,898 | 694 | no SEC issuer with this normalized name |
| PROGRESSIVE CORP | COM | $90,018,985,361 | 1,381 | no SEC issuer with this normalized name |
| VANGUARD INDEX FDS | VALUE ETF | $89,563,043,321 | 2,113 | no SEC issuer with this normalized name |
| ISHARES TR | CORE US AGGBD ET | $87,990,654,779 | 1,606 | no SEC issuer with this normalized name |
| VANGUARD INDEX FDS | GROWTH ETF | $86,796,845,909 | 2,115 | no SEC issuer with this normalized name |
| ACCENTURE PLC IRELAND | SHS CLASS A | $83,779,684,080 | 1,510 | no SEC issuer with this normalized name |
| SHOPIFY INC | CL A SUB VTG SHS | $81,174,152,864 | 1,269 | class is not the issuer's common equity (or its ADR) |
| T-MOBILE US INC | COM | $80,813,042,492 | 1,415 | issuer lists several tickers and no recorded class rule applies |
| LOWES COS INC | COM | $80,775,491,123 | 2,011 | no SEC issuer with this normalized name |

## What verification meant here

RULE-BASED, not row-by-row: every shipped row was ACCEPTED BY AN AUTOMATED RULE and its `method` names that rule. `exact-name`: the normalized filed issuer name matches exactly one issuer (one CIK) in the pinned SEC company list, that issuer lists one ticker, and the class is a common-equity (or ADR) class. `class-resolved`: a multi-ticker issuer where one un-hyphenated line sits beside preferred-series listings, or a recorded issuer/class rule in `scripts/draft_ticker_mapping_13f.py` names the line. No row was reviewed individually by this step; `manual` is reserved for the per-row review pass. Anything else ships no ticker. The owner's spot check over `src/populus/ticker_mapping_13f.sample.json` is the pre-merge human step.

## Per-row review pass (after the rule-based promote)

Updated 2026-09-11 08:21 UTC. Rows judged one at a time by the developer agent, in descending value order over the unmapped target rows: issuer identity and share class checked against the SEC company list title for the named CIK. `method: manual` marks these rows; `rejected:` in the mapping file records the keys judged to have no reviewed listing.

| Verified rows total (exact-name / class-resolved / manual) | 2,735 (1,421 / 110 / 1,204) |
|---|---|
| Rows rejected in review | 855 ($7,016,536,851,296) |
| Target rows still unreviewed | 2,669 |
| Verified target value | $52,120,507,291,717 of $59,317,769,474,420 (**87.9%**) |
