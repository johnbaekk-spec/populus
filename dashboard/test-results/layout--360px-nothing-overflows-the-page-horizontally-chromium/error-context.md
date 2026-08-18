# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: layout.spec.ts >> @360px >> nothing overflows the page horizontally
- Location: test/geometry/layout.spec.ts:73:5

# Error details

```
Error: the page scrolls sideways by 29px at 360px — widest offender: div.filter-controls reaching x=389 against a 360px viewport

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1
Received:    29
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]:
      - link "Public Filings home" [ref=e5] [cursor=pointer]:
        - /url: /
        - generic [ref=e9]: Public Filings
      - generic [ref=e10]:
        - button "Search" [ref=e11] [cursor=pointer]: ⌕
        - button "Switch to dark theme" [ref=e12] [cursor=pointer]: ☾ dark
        - button "Menu" [ref=e13] [cursor=pointer]: ☰
  - main [ref=e14]:
    - generic [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]: /congress
        - heading "Congressional trading" [level=1] [ref=e18]
        - paragraph [ref=e19]:
          - text: Periodic Transaction Reports from the House Clerk and Senate eFD. Amounts are disclosed in statutory ranges and filed up to 45 days after the trade — what you read here is what was filed; nothing more current exists in the public record.
          - link "How this data is made ↗" [ref=e20] [cursor=pointer]:
            - /url: /methodology/
        - generic [ref=e21]: 71,714 rows filed since 2014 · as of 2026-08-17 19:54 UTC · statutory ranges, filed up to 45d after the trade
      - list "Data coverage" [ref=e22]:
        - listitem "transactions in the default view (active filings minus superseded amendment originals). Counts filings made in this window; disclosed trade dates can be earlier." [ref=e23]:
          - generic [ref=e24]: 71,714
          - generic [ref=e25]: rows filed since 2014
        - listitem "fully parsed 5532 of 5892 e-filed House PTRs; 360 partial. A further 2445 of 8337 total House filings are paper and not machine-readable — excluded from this denominator and counted in the paper tile." [ref=e27]:
          - generic [ref=e28]: 93.8%
          - generic [ref=e29]: House parse · 5892 e-filed
        - listitem "fully parsed 1809 of 1809 e-filed Senate PTRs; 0 partial. A further 602 of 2411 total Senate filings are paper and not machine-readable — excluded from this denominator and counted in the paper tile." [ref=e31]:
          - generic [ref=e32]: 100%
          - generic [ref=e33]: Senate parse · 1809 e-filed
        - listitem "filings submitted on paper — retained and counted in filing totals with zero transaction rows, not yet machine-readable. Excluded from the parse denominators above, which count e-filed filings only." [ref=e35]:
          - generic [ref=e36]: "3047"
          - generic [ref=e37]: paper · need OCR · 2445 H · 602 S
    - navigation "Congress views" [ref=e39]:
      - generic [ref=e40]: Feed
      - link "Leaders" [ref=e41] [cursor=pointer]:
        - /url: /congress/leaders/
      - link "Tickers" [ref=e42] [cursor=pointer]:
        - /url: /congress/tickers/
    - generic [ref=e43]:
      - generic [ref=e44]:
        - group "Chamber" [ref=e45]:
          - generic [ref=e46]:
            - button "All" [pressed] [ref=e47] [cursor=pointer]
            - button "House" [ref=e48] [cursor=pointer]
            - button "Senate" [ref=e49] [cursor=pointer]
        - group "Party" [ref=e50]:
          - generic [ref=e51]:
            - button "All" [pressed] [ref=e52] [cursor=pointer]
            - button "Democratic" [ref=e53] [cursor=pointer]: D
            - button "Republican" [ref=e54] [cursor=pointer]: R
            - button "Independent" [ref=e55] [cursor=pointer]: I
        - group "Side" [ref=e56]:
          - generic [ref=e57]:
            - button "All" [pressed] [ref=e58] [cursor=pointer]
            - button "Purchase" [ref=e59] [cursor=pointer]
            - button "Sale" [ref=e60] [cursor=pointer]
            - button "Exch." [ref=e61] [cursor=pointer]
        - combobox "Amount ≥" [ref=e63] [cursor=pointer]:
          - option "any bucket" [selected]
          - option "≥ $15K"
          - option "≥ $50K"
          - option "≥ $100K"
          - option "≥ $250K"
          - option "≥ $500K"
          - option "≥ $1M"
          - option "≥ $5M"
          - option "≥ $25M"
          - option "≥ $50M"
        - combobox "Owner" [ref=e65] [cursor=pointer]:
          - option "all" [selected]
          - option "self"
          - option "spouse (SP)"
          - option "child (DC)"
          - option "joint (JT)"
          - option "not stated"
        - generic [ref=e66] [cursor=pointer]:
          - checkbox "late filings only" [ref=e67]
          - text: late only
        - generic [ref=e68] [cursor=pointer]:
          - checkbox "watched members and tickers only — stored in this browser" [ref=e69]
          - text: watched only ·
          - link "watchlist ↗" [ref=e70]:
            - /url: /watchlist/
        - searchbox "filter by ticker prefix or member name — on this device" [ref=e72] [cursor=pointer]
        - generic [ref=e73]:
          - combobox "date basis for the range filter" [ref=e74] [cursor=pointer]:
            - option "filed" [selected]
            - option "traded"
          - textbox "from date" [ref=e75] [cursor=pointer]
          - generic [ref=e76]: –
          - textbox "to date" [ref=e77] [cursor=pointer]
        - combobox "Sort" [ref=e79] [cursor=pointer]:
          - option "newest filed" [selected]
          - option "amount — largest lower bound"
          - option "amount — smallest lower bound"
      - generic [ref=e80]:
        - text: 1–50 of 71,714 transactions · 3,047 paper filings (2 here) · filtered on this device
        - generic [ref=e81]:
          - text: ·
          - button "reset" [ref=e82] [cursor=pointer]
    - generic [ref=e83]:
      - list "Disclosed transactions" [ref=e84]:
        - listitem [ref=e85]:
          - button "Watch Mark R. Warner — saved in this browser only" [ref=e87] [cursor=pointer]: ☆
          - generic [ref=e88]:
            - generic [ref=e89]: Filed
            - text: 2026-08-14
          - generic [ref=e90]:
            - generic [ref=e91]:
              - generic [ref=e92]: Member
              - link "Mark R. Warner" [ref=e93] [cursor=pointer]:
                - /url: /congress/members/W000805/
              - text: D–VA
            - generic [ref=e94]:
              - generic [ref=e95]: Ticker
              - 'generic "Manassas VA GO Public Improvement Refunding Bonds · asset type as filed: Municipal Security" [ref=e96]':
                - text: Manassas VA GO Public Improvement Ref…
                - generic [ref=e97]: "Manassas VA GO Public Improvement Refunding Bonds — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e98]:
              - generic [ref=e99]: Side
              - text: Purchase
          - generic [ref=e100]:
            - generic [ref=e101]:
              - generic [ref=e102]: Traded
              - generic [ref=e103]: 07-07
              - text: 07-07 → 08-14 +38d
            - generic [ref=e104]:
              - generic [ref=e105]: Amount
              - text: $50K–$100K
              - generic [ref=e106]: $50K–$100K
            - generic [ref=e107]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e112] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/047c4167-e0a9-44d4-a2bf-5477eb6b20ab/
              - text: eFD ↗
        - listitem [ref=e113]:
          - button "Watch Mark R. Warner — saved in this browser only" [ref=e115] [cursor=pointer]: ☆
          - generic [ref=e116]:
            - generic [ref=e117]: Filed
            - text: 2026-08-14
          - generic [ref=e118]:
            - generic [ref=e119]:
              - generic [ref=e120]: Member
              - link "Mark R. Warner" [ref=e121] [cursor=pointer]:
                - /url: /congress/members/W000805/
              - text: D–VA
            - generic [ref=e122]:
              - generic [ref=e123]: Ticker
              - 'generic "Virginia Beach VA GO Public Improvement Bonds · asset type as filed: Municipal Security" [ref=e124]':
                - text: Virginia Beach VA GO Public Improveme…
                - generic [ref=e125]: "Virginia Beach VA GO Public Improvement Bonds — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e126]:
              - generic [ref=e127]: Side
              - text: Purchase
          - generic [ref=e128]:
            - generic [ref=e129]:
              - generic [ref=e130]: Traded
              - generic [ref=e131]: 07-02
              - text: 07-02 → 08-14 +43d
            - generic [ref=e132]:
              - generic [ref=e133]: Amount
              - text: $100K–$250K
              - generic [ref=e134]: $100K–$250K
            - generic [ref=e135]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e140] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/047c4167-e0a9-44d4-a2bf-5477eb6b20ab/
              - text: eFD ↗
        - listitem [ref=e141]:
          - button "Watch Mark R. Warner — saved in this browser only" [ref=e143] [cursor=pointer]: ☆
          - generic [ref=e144]:
            - generic [ref=e145]: Filed
            - text: 2026-08-14
          - generic [ref=e146]:
            - generic [ref=e147]:
              - generic [ref=e148]: Member
              - link "Mark R. Warner" [ref=e149] [cursor=pointer]:
                - /url: /congress/members/W000805/
              - text: D–VA
            - generic [ref=e150]:
              - generic [ref=e151]: Ticker
              - 'generic "Alexandria VA GO Capital Improvement Bonds · asset type as filed: Municipal Security" [ref=e152]':
                - text: Alexandria VA GO Capital Improvement …
                - generic [ref=e153]: "Alexandria VA GO Capital Improvement Bonds — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e154]:
              - generic [ref=e155]: Side
              - text: Purchase
          - generic [ref=e156]:
            - generic [ref=e157]:
              - generic [ref=e158]: Traded
              - generic [ref=e159]: 07-02
              - text: 07-02 → 08-14 +43d
            - generic [ref=e160]:
              - generic [ref=e161]: Amount
              - text: $50K–$100K
              - generic [ref=e162]: $50K–$100K
            - generic [ref=e163]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e168] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/047c4167-e0a9-44d4-a2bf-5477eb6b20ab/
              - text: eFD ↗
        - listitem [ref=e169]:
          - button "Watch William R. Keating — saved in this browser only" [ref=e171] [cursor=pointer]: ☆
          - generic [ref=e172]:
            - generic [ref=e173]: Filed
            - text: 2026-08-13
          - generic [ref=e174]:
            - generic [ref=e175]:
              - generic [ref=e176]: Member
              - link "William R. Keating" [ref=e177] [cursor=pointer]:
                - /url: /congress/members/K000375/
              - text: D–MA-9
            - generic [ref=e178]:
              - generic [ref=e179]: Ticker
              - 'generic "CAPITAL ONE FINL CORP NOTE 7.62400% 10/30/2031 [CS] · asset type as filed: CS" [ref=e180]':
                - text: CAPITAL ONE FINL CORP NOTE 7.62400% 1…
                - generic [ref=e181]: "CAPITAL ONE FINL CORP NOTE 7.62400% 10/30/2031 [CS] — asset type as filed: CS — asset as filed, no ticker disclosed"
            - generic [ref=e182]:
              - generic [ref=e183]: Side
              - text: Purchase
          - generic [ref=e184]:
            - generic [ref=e185]:
              - generic [ref=e186]: Traded
              - generic [ref=e187]: 06-30
              - text: 06-30 → 08-13 +44d
            - generic [ref=e188]:
              - generic [ref=e189]: Amount
              - text: $1K–$15K
              - generic [ref=e190]: $1K–$15K
            - generic [ref=e191]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e196] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034898.pdf
              - text: PTR ↗
        - listitem [ref=e197]:
          - button "Watch William R. Keating — saved in this browser only" [ref=e199] [cursor=pointer]: ☆
          - generic [ref=e200]:
            - generic [ref=e201]: Filed
            - text: 2026-08-13
          - generic [ref=e202]:
            - generic [ref=e203]:
              - generic [ref=e204]: Member
              - link "William R. Keating" [ref=e205] [cursor=pointer]:
                - /url: /congress/members/K000375/
              - text: D–MA-9
            - generic [ref=e206]:
              - generic [ref=e207]: Ticker
              - 'generic "HCA INC. NOTE CALL MAKE WHOLE 5.62500% 09/01/2028 [CS] · asset type as filed: CS" [ref=e208]':
                - text: HCA INC. NOTE CALL MAKE WHOLE 5.62500…
                - generic [ref=e209]: "HCA INC. NOTE CALL MAKE WHOLE 5.62500% 09/01/2028 [CS] — asset type as filed: CS — asset as filed, no ticker disclosed"
            - generic [ref=e210]:
              - generic [ref=e211]: Side
              - text: Purchase
          - generic [ref=e212]:
            - generic [ref=e213]:
              - generic [ref=e214]: Traded
              - generic [ref=e215]: 06-30
              - text: 06-30 → 08-13 +44d
            - generic [ref=e216]:
              - generic [ref=e217]: Amount
              - text: $15K–$50K
              - generic [ref=e218]: $15K–$50K
            - generic [ref=e219]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e224] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034898.pdf
              - text: PTR ↗
        - listitem [ref=e225]:
          - button "Watch Shri Thanedar — saved in this browser only" [ref=e227] [cursor=pointer]: ☆
          - generic [ref=e228]:
            - generic [ref=e229]: Filed
            - text: 2026-08-13
          - generic [ref=e230]:
            - generic [ref=e231]:
              - generic [ref=e232]: Member
              - link "Shri Thanedar" [ref=e233] [cursor=pointer]:
                - /url: /congress/members/T000488/
              - text: D–MI-13
            - generic [ref=e234]:
              - generic [ref=e235]: Ticker
              - link "AAPL" [ref=e236] [cursor=pointer]:
                - /url: /tickers/AAPL/
            - generic [ref=e237]:
              - generic [ref=e238]: Side
              - text: Sale
              - generic "partial sale" [ref=e239]:
                - text: · partial
                - generic [ref=e240]: (partial sale)
          - generic [ref=e241]:
            - generic [ref=e242]:
              - generic [ref=e243]: Traded
              - generic [ref=e244]: 01-09
              - text: 01-09 → 08-13
              - generic [ref=e245]: LATE·216d
            - generic [ref=e246]:
              - generic [ref=e247]: Amount
              - text: $100K–$250K
              - generic [ref=e248]: $100K–$250K
            - link "source document (PTR) — opens in a new tab" [ref=e253] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033910.pdf
              - text: PTR ↗
        - listitem [ref=e254]:
          - button [disabled] [ref=e256]: ☆
          - generic [ref=e257]:
            - generic [ref=e258]: Filed
            - text: 2026-08-13
          - generic [ref=e259]:
            - generic [ref=e260]:
              - generic [ref=e261]: Member
              - link "Sheehy, Timothy P" [ref=e262] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e263]: †
              - text: —
            - generic [ref=e264]:
              - generic [ref=e265]: Ticker
              - 'generic "Max Ventures New World Opportunities Fund LP - Sana Labs AB · asset type as filed: Non-Public Stock" [ref=e266]':
                - text: Max Ventures New World Opportunities …
                - generic [ref=e267]: "Max Ventures New World Opportunities Fund LP - Sana Labs AB — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e268]:
              - generic [ref=e269]: Side
              - text: Sale
          - generic [ref=e270]:
            - generic [ref=e271]:
              - generic [ref=e272]: Traded
              - generic [ref=e273]: 2025-11-04
              - text: 2025-11-04 → 08-13
              - generic [ref=e274]: LATE·282d
            - generic [ref=e275]:
              - generic [ref=e276]: Amount
              - text: $50K–$100K
              - generic [ref=e277]: $50K–$100K
            - generic [ref=e278]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e283] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e284]:
          - button [disabled] [ref=e286]: ☆
          - generic [ref=e287]:
            - generic [ref=e288]: Filed
            - text: 2026-08-13
          - generic [ref=e289]:
            - generic [ref=e290]:
              - generic [ref=e291]: Member
              - link "Sheehy, Timothy P" [ref=e292] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e293]: †
              - text: —
            - generic [ref=e294]:
              - generic [ref=e295]: Ticker
              - 'generic "WCAS XIV Co-Investors LLC - Grant Street Group · asset type as filed: Non-Public Stock" [ref=e296]':
                - text: WCAS XIV Co-Investors LLC - Grant Str…
                - generic [ref=e297]: "WCAS XIV Co-Investors LLC - Grant Street Group — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e298]:
              - generic [ref=e299]: Side
              - text: Purchase
          - generic [ref=e300]:
            - generic [ref=e301]:
              - generic [ref=e302]: Traded
              - generic [ref=e303]: 2025-11-03
              - text: 2025-11-03 → 08-13
              - generic [ref=e304]: LATE·283d
            - generic [ref=e305]:
              - generic [ref=e306]: Amount
              - text: $1K–$15K
              - generic [ref=e307]: $1K–$15K
            - generic [ref=e308]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e313] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e314]:
          - button "Watch Shri Thanedar — saved in this browser only" [ref=e316] [cursor=pointer]: ☆
          - generic [ref=e317]:
            - generic [ref=e318]: Filed
            - text: 2026-08-13
          - generic [ref=e319]:
            - generic [ref=e320]:
              - generic [ref=e321]: Member
              - link "Shri Thanedar" [ref=e322] [cursor=pointer]:
                - /url: /congress/members/T000488/
              - text: D–MI-13
            - generic [ref=e323]:
              - generic [ref=e324]: Ticker
              - link "MSTR" [ref=e325] [cursor=pointer]:
                - /url: /tickers/MSTR/
            - generic [ref=e326]:
              - generic [ref=e327]: Side
              - text: Sale
          - generic [ref=e328]:
            - generic [ref=e329]:
              - generic [ref=e330]: Traded
              - generic [ref=e331]: 2025-10-21
              - text: 2025-10-21 → 08-13
              - generic [ref=e332]: LATE·296d
            - generic [ref=e333]:
              - generic [ref=e334]: Amount
              - text: $15K–$50K
              - generic [ref=e335]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e340] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033910.pdf
              - text: PTR ↗
        - listitem [ref=e341]:
          - button "Watch Derek Tran — saved in this browser only" [ref=e343] [cursor=pointer]: ☆
          - generic [ref=e344]:
            - generic [ref=e345]: Filed
            - text: 2026-08-13
          - generic [ref=e346]:
            - generic [ref=e347]:
              - generic [ref=e348]: Member
              - link "Derek Tran" [ref=e349] [cursor=pointer]:
                - /url: /congress/members/T000491/
              - text: D–CA-45
            - generic [ref=e350]:
              - generic [ref=e351]: Ticker
              - link "LTC" [ref=e352] [cursor=pointer]:
                - /url: /tickers/LTC/
            - generic [ref=e353]:
              - generic [ref=e354]: Side
              - text: Sale
          - generic [ref=e355]:
            - generic [ref=e356]:
              - generic [ref=e357]: Traded
              - generic [ref=e358]: 2025-07-28
              - text: 2025-07-28 → 08-13
              - generic [ref=e359]: LATE·381d
            - generic [ref=e360]:
              - generic [ref=e361]: Amount
              - text: $1K–$15K
              - generic [ref=e362]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e367] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035183.pdf
              - text: PTR ↗
        - listitem [ref=e368]:
          - button [disabled] [ref=e370]: ☆
          - generic [ref=e371]:
            - generic [ref=e372]: Filed
            - text: 2026-08-13
          - generic [ref=e373]:
            - generic [ref=e374]:
              - generic [ref=e375]: Member
              - link "Sheehy, Timothy P" [ref=e376] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e377]: †
              - text: —
            - generic [ref=e378]:
              - generic [ref=e379]: Ticker
              - 'generic "WCAS XIV Co-Investors LLC - AIA Contract Documents · asset type as filed: Non-Public Stock" [ref=e380]':
                - text: WCAS XIV Co-Investors LLC - AIA Contr…
                - generic [ref=e381]: "WCAS XIV Co-Investors LLC - AIA Contract Documents — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e382]:
              - generic [ref=e383]: Side
              - text: Purchase
          - generic [ref=e384]:
            - generic [ref=e385]:
              - generic [ref=e386]: Traded
              - generic [ref=e387]: 2025-07-08
              - text: 2025-07-08 → 08-13
              - generic [ref=e388]: LATE·401d
            - generic [ref=e389]:
              - generic [ref=e390]: Amount
              - text: $1K–$15K
              - generic [ref=e391]: $1K–$15K
            - generic [ref=e392]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e397] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e398]:
          - button [disabled] [ref=e400]: ☆
          - generic [ref=e401]:
            - generic [ref=e402]: Filed
            - text: 2026-08-13
          - generic [ref=e403]:
            - generic [ref=e404]:
              - generic [ref=e405]: Member
              - link "Sheehy, Timothy P" [ref=e406] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e407]: †
              - text: —
            - generic [ref=e408]:
              - generic [ref=e409]: Ticker
              - 'generic "Ansett Aerospace Holdings LLC - Regaero Holdings Pty Ltd · asset type as filed: Non-Public Stock" [ref=e410]':
                - text: Ansett Aerospace Holdings LLC - Regae…
                - generic [ref=e411]: "Ansett Aerospace Holdings LLC - Regaero Holdings Pty Ltd — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e412]:
              - generic [ref=e413]: Side
              - text: Sale
          - generic [ref=e414]:
            - generic [ref=e415]:
              - generic [ref=e416]: Traded
              - generic [ref=e417]: 2025-06-28
              - text: 2025-06-28 → 08-13
              - generic [ref=e418]: LATE·411d
            - generic [ref=e419]:
              - generic [ref=e420]: Amount
              - text: $500K–$1M
              - generic [ref=e421]: $500K–$1M
            - generic [ref=e422]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e427] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e428]:
          - button [disabled] [ref=e430]: ☆
          - generic [ref=e431]:
            - generic [ref=e432]: Filed
            - text: 2026-08-13
          - generic [ref=e433]:
            - generic [ref=e434]:
              - generic [ref=e435]: Member
              - link "Sheehy, Timothy P" [ref=e436] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e437]: †
              - text: —
            - generic [ref=e438]:
              - generic [ref=e439]: Ticker
              - 'generic "WCAS XIV Co-Investors LLC - Constitution Surgery Alliance · asset type as filed: Non-Public Stock" [ref=e440]':
                - text: WCAS XIV Co-Investors LLC - Constitut…
                - generic [ref=e441]: "WCAS XIV Co-Investors LLC - Constitution Surgery Alliance — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e442]:
              - generic [ref=e443]: Side
              - text: Purchase
          - generic [ref=e444]:
            - generic [ref=e445]:
              - generic [ref=e446]: Traded
              - generic [ref=e447]: 2025-06-16
              - text: 2025-06-16 → 08-13
              - generic [ref=e448]: LATE·423d
            - generic [ref=e449]:
              - generic [ref=e450]: Amount
              - text: $1K–$15K
              - generic [ref=e451]: $1K–$15K
            - generic [ref=e452]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e457] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e458]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e460] [cursor=pointer]: ☆
          - generic [ref=e461]:
            - generic [ref=e462]: Filed
            - text: 2026-08-13
          - generic [ref=e463]:
            - generic [ref=e464]:
              - generic [ref=e465]: Member
              - link "Carol D. Miller" [ref=e466] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e467]:
              - generic [ref=e468]: Ticker
              - link "DGX" [ref=e469] [cursor=pointer]:
                - /url: /tickers/DGX/
            - generic [ref=e470]:
              - generic [ref=e471]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e472]:
                - text: · SP
                - generic [ref=e473]: (spouse-owned)
          - generic [ref=e474]:
            - generic [ref=e475]:
              - generic [ref=e476]: Traded
              - generic [ref=e477]: 2025-03-10
              - text: 2025-03-10 → 08-13
              - generic [ref=e478]: LATE·521d
            - generic [ref=e479]:
              - generic [ref=e480]: Amount
              - text: $15K–$50K
              - generic [ref=e481]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e486] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e487]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e489] [cursor=pointer]: ☆
          - generic [ref=e490]:
            - generic [ref=e491]: Filed
            - text: 2026-08-13
          - generic [ref=e492]:
            - generic [ref=e493]:
              - generic [ref=e494]: Member
              - link "Carol D. Miller" [ref=e495] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e496]:
              - generic [ref=e497]: Ticker
              - link "TGT" [ref=e498] [cursor=pointer]:
                - /url: /tickers/TGT/
            - generic [ref=e499]:
              - generic [ref=e500]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e501]:
                - text: · SP
                - generic [ref=e502]: (spouse-owned)
          - generic [ref=e503]:
            - generic [ref=e504]:
              - generic [ref=e505]: Traded
              - generic [ref=e506]: 2025-03-10
              - text: 2025-03-10 → 08-13
              - generic [ref=e507]: LATE·521d
            - generic [ref=e508]:
              - generic [ref=e509]: Amount
              - text: $15K–$50K
              - generic [ref=e510]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e515] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e516]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e518] [cursor=pointer]: ☆
          - generic [ref=e519]:
            - generic [ref=e520]: Filed
            - text: 2026-08-13
          - generic [ref=e521]:
            - generic [ref=e522]:
              - generic [ref=e523]: Member
              - link "Carol D. Miller" [ref=e524] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e525]:
              - generic [ref=e526]: Ticker
              - link "PFE" [ref=e527] [cursor=pointer]:
                - /url: /tickers/PFE/
            - generic [ref=e528]:
              - generic [ref=e529]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e530]:
                - text: · SP
                - generic [ref=e531]: (spouse-owned)
          - generic [ref=e532]:
            - generic [ref=e533]:
              - generic [ref=e534]: Traded
              - generic [ref=e535]: 2025-03-10
              - text: 2025-03-10 → 08-13
              - generic [ref=e536]: LATE·521d
            - generic [ref=e537]:
              - generic [ref=e538]: Amount
              - text: $15K–$50K
              - generic [ref=e539]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e544] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e545]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e547] [cursor=pointer]: ☆
          - generic [ref=e548]:
            - generic [ref=e549]: Filed
            - text: 2026-08-13
          - generic [ref=e550]:
            - generic [ref=e551]:
              - generic [ref=e552]: Member
              - link "Carol D. Miller" [ref=e553] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e554]:
              - generic [ref=e555]: Ticker
              - link "USB" [ref=e556] [cursor=pointer]:
                - /url: /tickers/USB/
            - generic [ref=e557]:
              - generic [ref=e558]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e559]:
                - text: · SP
                - generic [ref=e560]: (spouse-owned)
          - generic [ref=e561]:
            - generic [ref=e562]:
              - generic [ref=e563]: Traded
              - generic [ref=e564]: 2025-03-10
              - text: 2025-03-10 → 08-13
              - generic [ref=e565]: LATE·521d
            - generic [ref=e566]:
              - generic [ref=e567]: Amount
              - text: $15K–$50K
              - generic [ref=e568]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e573] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e574]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e576] [cursor=pointer]: ☆
          - generic [ref=e577]:
            - generic [ref=e578]: Filed
            - text: 2026-08-13
          - generic [ref=e579]:
            - generic [ref=e580]:
              - generic [ref=e581]: Member
              - link "Rick Scott" [ref=e582] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e583]:
              - generic [ref=e584]: Ticker
              - 'generic "Port of Seattle Washington Revenue Bond · asset type as filed: Municipal Security" [ref=e585]':
                - text: Port of Seattle Washington Revenue Bond
                - generic [ref=e586]: "Port of Seattle Washington Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e587]:
              - generic [ref=e588]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e589]:
                - text: · SP
                - generic [ref=e590]: (spouse-owned)
          - generic [ref=e591]:
            - generic [ref=e592]:
              - generic [ref=e593]: Traded
              - generic [ref=e594]: 2025-02-07
              - text: 2025-02-07 → 08-13
              - generic [ref=e595]: LATE·552d
            - generic [ref=e596]:
              - generic [ref=e597]: Amount
              - text: $250K–$500K
              - generic [ref=e598]: $250K–$500K
            - generic [ref=e599]:
              - generic [ref=e602]: amendment pending
              - generic [ref=e603]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e605] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e606]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e608] [cursor=pointer]: ☆
          - generic [ref=e609]:
            - generic [ref=e610]: Filed
            - text: 2026-08-13
          - generic [ref=e611]:
            - generic [ref=e612]:
              - generic [ref=e613]: Member
              - link "Rick Scott" [ref=e614] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e615]:
              - generic [ref=e616]: Ticker
              - 'generic "Central Texas Regional Mobility Auth Revenue Bond · asset type as filed: Municipal Security" [ref=e617]':
                - text: Central Texas Regional Mobility Auth …
                - generic [ref=e618]: "Central Texas Regional Mobility Auth Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e619]:
              - generic [ref=e620]: Side
              - text: Sale
          - generic [ref=e621]:
            - generic [ref=e622]:
              - generic [ref=e623]: Traded
              - generic [ref=e624]: 2025-02-07
              - text: 2025-02-07 → 08-13
              - generic [ref=e625]: LATE·552d
            - generic [ref=e626]:
              - generic [ref=e627]: Amount
              - text: $500K–$1M
              - generic [ref=e628]: $500K–$1M
            - generic [ref=e629]:
              - generic [ref=e632]: amendment pending
              - generic [ref=e633]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e635] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e636]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e638] [cursor=pointer]: ☆
          - generic [ref=e639]:
            - generic [ref=e640]: Filed
            - text: 2026-08-13
          - generic [ref=e641]:
            - generic [ref=e642]:
              - generic [ref=e643]: Member
              - link "Rick Scott" [ref=e644] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e645]:
              - generic [ref=e646]: Ticker
              - 'generic "Port of Seattle Washington Revenue Bond · asset type as filed: Municipal Security" [ref=e647]':
                - text: Port of Seattle Washington Revenue Bond
                - generic [ref=e648]: "Port of Seattle Washington Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e649]:
              - generic [ref=e650]: Side
              - text: Sale
          - generic [ref=e651]:
            - generic [ref=e652]:
              - generic [ref=e653]: Traded
              - generic [ref=e654]: 2025-02-07
              - text: 2025-02-07 → 08-13
              - generic [ref=e655]: LATE·552d
            - generic [ref=e656]:
              - generic [ref=e657]: Amount
              - text: $100K–$250K
              - generic [ref=e658]: $100K–$250K
            - generic [ref=e659]:
              - generic [ref=e662]: amendment pending
              - generic [ref=e663]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e665] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e666]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e668] [cursor=pointer]: ☆
          - generic [ref=e669]:
            - generic [ref=e670]: Filed
            - text: 2026-08-13
          - generic [ref=e671]:
            - generic [ref=e672]:
              - generic [ref=e673]: Member
              - link "Rick Scott" [ref=e674] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e675]:
              - generic [ref=e676]: Ticker
              - 'generic "Charlotte NC Water & Sewer Sys Revenue Bond · asset type as filed: Municipal Security" [ref=e677]':
                - text: Charlotte NC Water & Sewer Sys Revenu…
                - generic [ref=e678]: "Charlotte NC Water & Sewer Sys Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e679]:
              - generic [ref=e680]: Side
              - text: Purchase
              - generic "spouse-owned" [ref=e681]:
                - text: · SP
                - generic [ref=e682]: (spouse-owned)
          - generic [ref=e683]:
            - generic [ref=e684]:
              - generic [ref=e685]: Traded
              - generic [ref=e686]: 2025-02-07
              - text: 2025-02-07 → 08-13
              - generic [ref=e687]: LATE·552d
            - generic [ref=e688]:
              - generic [ref=e689]: Amount
              - text: $250K–$500K
              - generic [ref=e690]: $250K–$500K
            - generic [ref=e691]:
              - generic [ref=e694]: amendment pending
              - generic [ref=e695]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e697] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e698]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e700] [cursor=pointer]: ☆
          - generic [ref=e701]:
            - generic [ref=e702]: Filed
            - text: 2026-08-13
          - generic [ref=e703]:
            - generic [ref=e704]:
              - generic [ref=e705]: Member
              - link "Rick Scott" [ref=e706] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e707]:
              - generic [ref=e708]: Ticker
              - 'generic "Charlotte NC Water & Sewer Sys Revenue Bond · asset type as filed: Municipal Security" [ref=e709]':
                - text: Charlotte NC Water & Sewer Sys Revenu…
                - generic [ref=e710]: "Charlotte NC Water & Sewer Sys Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e711]:
              - generic [ref=e712]: Side
              - text: Purchase
          - generic [ref=e713]:
            - generic [ref=e714]:
              - generic [ref=e715]: Traded
              - generic [ref=e716]: 2025-02-07
              - text: 2025-02-07 → 08-13
              - generic [ref=e717]: LATE·552d
            - generic [ref=e718]:
              - generic [ref=e719]: Amount
              - text: $100K–$250K
              - generic [ref=e720]: $100K–$250K
            - generic [ref=e721]:
              - generic [ref=e724]: amendment pending
              - generic [ref=e725]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e727] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e728]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e730] [cursor=pointer]: ☆
          - generic [ref=e731]:
            - generic [ref=e732]: Filed
            - text: 2026-08-13
          - generic [ref=e733]:
            - generic [ref=e734]:
              - generic [ref=e735]: Member
              - link "Rick Scott" [ref=e736] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e737]:
              - generic [ref=e738]: Ticker
              - 'generic "Charlotte NC Water & Sewer Sys Revenue Bond · asset type as filed: Municipal Security" [ref=e739]':
                - text: Charlotte NC Water & Sewer Sys Revenu…
                - generic [ref=e740]: "Charlotte NC Water & Sewer Sys Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e741]:
              - generic [ref=e742]: Side
              - text: Purchase
          - generic [ref=e743]:
            - generic [ref=e744]:
              - generic [ref=e745]: Traded
              - generic [ref=e746]: 2025-02-07
              - text: 2025-02-07 → 08-13
              - generic [ref=e747]: LATE·552d
            - generic [ref=e748]:
              - generic [ref=e749]: Amount
              - text: $500K–$1M
              - generic [ref=e750]: $500K–$1M
            - generic [ref=e751]:
              - generic [ref=e754]: amendment pending
              - generic [ref=e755]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e757] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e758]:
          - button "Watch Tracey Mann — saved in this browser only" [ref=e760] [cursor=pointer]: ☆
          - generic [ref=e761]:
            - generic [ref=e762]: Filed
            - text: 2026-08-13
          - generic [ref=e763]:
            - link "Tracey Mann" [ref=e764] [cursor=pointer]:
              - /url: /congress/members/M000871/
            - generic [ref=e765]: R–KS-1
            - generic [ref=e766]: paper filing — needs OCR
            - generic [ref=e767]: transactions filed on paper; retained and counted, not yet machine-readable
          - link "source document (PTR) — opens in a new tab" [ref=e769] [cursor=pointer]:
            - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/9116292.pdf
            - text: PTR ↗
        - listitem [ref=e770]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e772] [cursor=pointer]: ☆
          - generic [ref=e773]:
            - generic [ref=e774]: Filed
            - text: 2026-08-12
          - generic [ref=e775]:
            - generic [ref=e776]:
              - generic [ref=e777]: Member
              - link "Kevin Hern" [ref=e778] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e779]:
              - generic [ref=e780]: Ticker
              - link "VSNT" [ref=e781] [cursor=pointer]:
                - /url: /tickers/VSNT/
            - generic [ref=e782]:
              - generic [ref=e783]: Side
              - text: Sale
              - generic "jointly owned" [ref=e784]:
                - text: · JT
                - generic [ref=e785]: (jointly owned)
          - generic [ref=e786]:
            - generic [ref=e787]:
              - generic [ref=e788]: Traded
              - generic [ref=e789]: 08-05
              - text: 08-05 → 08-12 +7d
            - generic [ref=e790]:
              - generic [ref=e791]: Amount
              - text: $1K–$15K
              - generic [ref=e792]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e797] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035196.pdf
              - text: PTR ↗
        - listitem [ref=e798]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e800] [cursor=pointer]: ☆
          - generic [ref=e801]:
            - generic [ref=e802]: Filed
            - text: 2026-08-12
          - generic [ref=e803]:
            - generic [ref=e804]:
              - generic [ref=e805]: Member
              - link "Kevin Hern" [ref=e806] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e807]:
              - generic [ref=e808]: Ticker
              - link "OGN" [ref=e809] [cursor=pointer]:
                - /url: /tickers/OGN/
            - generic [ref=e810]:
              - generic [ref=e811]: Side
              - text: Sale
              - generic "jointly owned" [ref=e812]:
                - text: · JT
                - generic [ref=e813]: (jointly owned)
          - generic [ref=e814]:
            - generic [ref=e815]:
              - generic [ref=e816]: Traded
              - generic [ref=e817]: 08-05
              - text: 08-05 → 08-12 +7d
            - generic [ref=e818]:
              - generic [ref=e819]: Amount
              - text: $1K–$15K
              - generic [ref=e820]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e825] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035196.pdf
              - text: PTR ↗
        - listitem [ref=e826]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e828] [cursor=pointer]: ☆
          - generic [ref=e829]:
            - generic [ref=e830]: Filed
            - text: 2026-08-12
          - generic [ref=e831]:
            - generic [ref=e832]:
              - generic [ref=e833]: Member
              - link "Mike Kelly" [ref=e834] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e835]:
              - generic [ref=e836]: Ticker
              - link "ABT" [ref=e837] [cursor=pointer]:
                - /url: /tickers/ABT/
            - generic [ref=e838]:
              - generic [ref=e839]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e840]:
                - text: · SP
                - generic [ref=e841]: (spouse-owned)
          - generic [ref=e842]:
            - generic [ref=e843]:
              - generic [ref=e844]: Traded
              - generic [ref=e845]: 07-17
              - text: 07-17 → 08-12 +26d
            - generic [ref=e846]:
              - generic [ref=e847]: Amount
              - text: $1K–$15K
              - generic [ref=e848]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e853] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e854]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e856] [cursor=pointer]: ☆
          - generic [ref=e857]:
            - generic [ref=e858]: Filed
            - text: 2026-08-12
          - generic [ref=e859]:
            - generic [ref=e860]:
              - generic [ref=e861]: Member
              - link "Mike Kelly" [ref=e862] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e863]:
              - generic [ref=e864]: Ticker
              - link "DIS" [ref=e865] [cursor=pointer]:
                - /url: /tickers/DIS/
            - generic [ref=e866]:
              - generic [ref=e867]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e868]:
                - text: · SP
                - generic [ref=e869]: (spouse-owned)
          - generic [ref=e870]:
            - generic [ref=e871]:
              - generic [ref=e872]: Traded
              - generic [ref=e873]: 07-17
              - text: 07-17 → 08-12 +26d
            - generic [ref=e874]:
              - generic [ref=e875]: Amount
              - text: $1K–$15K
              - generic [ref=e876]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e881] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e882]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e884] [cursor=pointer]: ☆
          - generic [ref=e885]:
            - generic [ref=e886]: Filed
            - text: 2026-08-12
          - generic [ref=e887]:
            - generic [ref=e888]:
              - generic [ref=e889]: Member
              - link "Mike Kelly" [ref=e890] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e891]:
              - generic [ref=e892]: Ticker
              - link "PEP" [ref=e893] [cursor=pointer]:
                - /url: /tickers/PEP/
            - generic [ref=e894]:
              - generic [ref=e895]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e896]:
                - text: · SP
                - generic [ref=e897]: (spouse-owned)
          - generic [ref=e898]:
            - generic [ref=e899]:
              - generic [ref=e900]: Traded
              - generic [ref=e901]: 07-17
              - text: 07-17 → 08-12 +26d
            - generic [ref=e902]:
              - generic [ref=e903]: Amount
              - text: $15K–$50K
              - generic [ref=e904]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e909] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e910]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e912] [cursor=pointer]: ☆
          - generic [ref=e913]:
            - generic [ref=e914]: Filed
            - text: 2026-08-12
          - generic [ref=e915]:
            - generic [ref=e916]:
              - generic [ref=e917]: Member
              - link "Mike Kelly" [ref=e918] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e919]:
              - generic [ref=e920]: Ticker
              - 'generic "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] · asset type as filed: GS" [ref=e921]':
                - text: California Cmnty Choice Fing & Clean …
                - generic [ref=e922]: "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e923]:
              - generic [ref=e924]: Side
              - text: Purchase
              - generic "spouse-owned" [ref=e925]:
                - text: · SP
                - generic [ref=e926]: (spouse-owned)
          - generic [ref=e927]:
            - generic [ref=e928]:
              - generic [ref=e929]: Traded
              - generic [ref=e930]: 07-17
              - text: 07-17 → 08-12 +26d
            - generic [ref=e931]:
              - generic [ref=e932]: Amount
              - text: $50K–$100K
              - generic [ref=e933]: $50K–$100K
            - generic [ref=e934]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e939] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035209.pdf
              - text: PTR ↗
        - listitem [ref=e940]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e942] [cursor=pointer]: ☆
          - generic [ref=e943]:
            - generic [ref=e944]: Filed
            - text: 2026-08-12
          - generic [ref=e945]:
            - generic [ref=e946]:
              - generic [ref=e947]: Member
              - link "Mike Kelly" [ref=e948] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e949]:
              - generic [ref=e950]: Ticker
              - 'generic "Florida St Hsg Fin Corp Rev 3% due 7/1/52 [GS] · asset type as filed: GS" [ref=e951]':
                - text: Florida St Hsg Fin Corp Rev 3% due 7/…
                - generic [ref=e952]: "Florida St Hsg Fin Corp Rev 3% due 7/1/52 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e953]:
              - generic [ref=e954]: Side
              - text: Sale
              - generic "partial sale, spouse-owned" [ref=e955]:
                - text: · partial · SP
                - generic [ref=e956]: (partial sale, spouse-owned)
          - generic [ref=e957]:
            - generic [ref=e958]:
              - generic [ref=e959]: Traded
              - generic [ref=e960]: 07-01
              - text: 07-01 → 08-12 +42d
            - generic [ref=e961]:
              - generic [ref=e962]: Amount
              - text: $1K–$15K
              - generic [ref=e963]: $1K–$15K
            - generic [ref=e964]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e969] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e970]:
          - button "Watch Robert P. Bresnahan, Jr. — saved in this browser only" [ref=e972] [cursor=pointer]: ☆
          - generic [ref=e973]:
            - generic [ref=e974]: Filed
            - text: 2026-08-12
          - generic [ref=e975]:
            - generic [ref=e976]:
              - generic [ref=e977]: Member
              - link "Robert P. Bresnahan, Jr." [ref=e978] [cursor=pointer]:
                - /url: /congress/members/B001327/
              - text: R–PA-8
            - generic [ref=e979]:
              - generic [ref=e980]: Ticker
              - 'generic "US Treasury Note 06/30/27 [GS] · asset type as filed: GS" [ref=e981]':
                - text: US Treasury Note 06/30/27 [GS]
                - generic [ref=e982]: "US Treasury Note 06/30/27 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e983]:
              - generic [ref=e984]: Side
              - text: Purchase
          - generic [ref=e985]:
            - generic [ref=e986]:
              - generic [ref=e987]: Traded
              - generic [ref=e988]: 07-01
              - text: 07-01 → 08-12 +42d
            - generic [ref=e989]:
              - generic [ref=e990]: Amount
              - text: $15K–$50K
              - generic [ref=e991]: $15K–$50K
            - generic [ref=e992]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e997] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035216.pdf
              - text: PTR ↗
        - listitem [ref=e998]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e1000] [cursor=pointer]: ☆
          - generic [ref=e1001]:
            - generic [ref=e1002]: Filed
            - text: 2026-08-12
          - generic [ref=e1003]:
            - generic [ref=e1004]:
              - generic [ref=e1005]: Member
              - link "Mike Kelly" [ref=e1006] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e1007]:
              - generic [ref=e1008]: Ticker
              - 'generic "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] · asset type as filed: GS" [ref=e1009]':
                - text: California Cmnty Choice Fing & Clean …
                - generic [ref=e1010]: "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1011]:
              - generic [ref=e1012]: Side
              - text: Purchase
              - generic "spouse-owned" [ref=e1013]:
                - text: · SP
                - generic [ref=e1014]: (spouse-owned)
          - generic [ref=e1015]:
            - generic [ref=e1016]:
              - generic [ref=e1017]: Traded
              - generic [ref=e1018]: 2025-07-17
              - text: 2025-07-17 → 08-12
              - generic [ref=e1019]: LATE·391d
            - generic [ref=e1020]:
              - generic [ref=e1021]: Amount
              - text: $50K–$100K
              - generic [ref=e1022]: $50K–$100K
            - generic [ref=e1023]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1028] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e1029]:
          - button "Watch Charles J. \"Chuck\" Fleischmann — saved in this browser only" [ref=e1031] [cursor=pointer]: ☆
          - generic [ref=e1032]:
            - generic [ref=e1033]: Filed
            - text: 2026-08-12
          - generic [ref=e1034]:
            - link "Charles J. \"Chuck\" Fleischmann" [ref=e1035] [cursor=pointer]:
              - /url: /congress/members/F000459/
            - generic [ref=e1036]: R–TN-3
            - generic [ref=e1037]: paper filing — needs OCR
            - generic [ref=e1038]: transactions filed on paper; retained and counted, not yet machine-readable
          - link "source document (PTR) — opens in a new tab" [ref=e1040] [cursor=pointer]:
            - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/9116290.pdf
            - text: PTR ↗
        - listitem [ref=e1041]:
          - button "Watch Suzan K. DelBene — saved in this browser only" [ref=e1043] [cursor=pointer]: ☆
          - generic [ref=e1044]:
            - generic [ref=e1045]: Filed
            - text: 2026-08-11
          - generic [ref=e1046]:
            - generic [ref=e1047]:
              - generic [ref=e1048]: Member
              - link "Suzan K. DelBene" [ref=e1049] [cursor=pointer]:
                - /url: /congress/members/D000617/
              - text: D–WA-1
            - generic [ref=e1050]:
              - generic [ref=e1051]: Ticker
              - 'generic "Fort Bend Tex Indpt SCH Dist Variable 04.00000% 08/01/2054 Rate Unltd Tax BLDG Ref BDS Ser. 2024B [GS] · asset type as filed: GS" [ref=e1052]':
                - text: Fort Bend Tex Indpt SCH Dist Variable…
                - generic [ref=e1053]: "Fort Bend Tex Indpt SCH Dist Variable 04.00000% 08/01/2054 Rate Unltd Tax BLDG Ref BDS Ser. 2024B [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1054]:
              - generic [ref=e1055]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1056]:
                - text: · JT
                - generic [ref=e1057]: (jointly owned)
          - generic [ref=e1058]:
            - generic [ref=e1059]:
              - generic [ref=e1060]: Traded
              - generic [ref=e1061]: 07-23
              - text: 07-23 → 08-11 +19d
            - generic [ref=e1062]:
              - generic [ref=e1063]: Amount
              - text: $250K–$500K
              - generic [ref=e1064]: $250K–$500K
            - generic [ref=e1065]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1070] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035175.pdf
              - text: PTR ↗
        - listitem [ref=e1071]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1073] [cursor=pointer]: ☆
          - generic [ref=e1074]:
            - generic [ref=e1075]: Filed
            - text: 2026-08-10
          - generic [ref=e1076]:
            - generic [ref=e1077]:
              - generic [ref=e1078]: Member
              - link "Kevin Hern" [ref=e1079] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1080]:
              - generic [ref=e1081]: Ticker
              - link "KVUE" [ref=e1082] [cursor=pointer]:
                - /url: /tickers/KVUE/
            - generic [ref=e1083]:
              - generic [ref=e1084]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1085]:
                - text: · JT
                - generic [ref=e1086]: (jointly owned)
          - generic [ref=e1087]:
            - generic [ref=e1088]:
              - generic [ref=e1089]: Traded
              - generic [ref=e1090]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1091]:
              - generic [ref=e1092]: Amount
              - text: $1K–$15K
              - generic [ref=e1093]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1098] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1099]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1101] [cursor=pointer]: ☆
          - generic [ref=e1102]:
            - generic [ref=e1103]: Filed
            - text: 2026-08-10
          - generic [ref=e1104]:
            - generic [ref=e1105]:
              - generic [ref=e1106]: Member
              - link "Kevin Hern" [ref=e1107] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1108]:
              - generic [ref=e1109]: Ticker
              - link "EL" [ref=e1110] [cursor=pointer]:
                - /url: /tickers/EL/
            - generic [ref=e1111]:
              - generic [ref=e1112]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1113]:
                - text: · JT
                - generic [ref=e1114]: (jointly owned)
          - generic [ref=e1115]:
            - generic [ref=e1116]:
              - generic [ref=e1117]: Traded
              - generic [ref=e1118]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1119]:
              - generic [ref=e1120]: Amount
              - text: $1K–$15K
              - generic [ref=e1121]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1126] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1127]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1129] [cursor=pointer]: ☆
          - generic [ref=e1130]:
            - generic [ref=e1131]: Filed
            - text: 2026-08-10
          - generic [ref=e1132]:
            - generic [ref=e1133]:
              - generic [ref=e1134]: Member
              - link "Kevin Hern" [ref=e1135] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1136]:
              - generic [ref=e1137]: Ticker
              - link "VSNT" [ref=e1138] [cursor=pointer]:
                - /url: /tickers/VSNT/
            - generic [ref=e1139]:
              - generic [ref=e1140]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1141]:
                - text: · JT
                - generic [ref=e1142]: (jointly owned)
          - generic [ref=e1143]:
            - generic [ref=e1144]:
              - generic [ref=e1145]: Traded
              - generic [ref=e1146]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1147]:
              - generic [ref=e1148]: Amount
              - text: $1K–$15K
              - generic [ref=e1149]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1154] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1155]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1157] [cursor=pointer]: ☆
          - generic [ref=e1158]:
            - generic [ref=e1159]: Filed
            - text: 2026-08-10
          - generic [ref=e1160]:
            - generic [ref=e1161]:
              - generic [ref=e1162]: Member
              - link "Kevin Hern" [ref=e1163] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1164]:
              - generic [ref=e1165]: Ticker
              - link "MDLZ" [ref=e1166] [cursor=pointer]:
                - /url: /tickers/MDLZ/
            - generic [ref=e1167]:
              - generic [ref=e1168]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1169]:
                - text: · JT
                - generic [ref=e1170]: (jointly owned)
          - generic [ref=e1171]:
            - generic [ref=e1172]:
              - generic [ref=e1173]: Traded
              - generic [ref=e1174]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1175]:
              - generic [ref=e1176]: Amount
              - text: $1K–$15K
              - generic [ref=e1177]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1182] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1183]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1185] [cursor=pointer]: ☆
          - generic [ref=e1186]:
            - generic [ref=e1187]: Filed
            - text: 2026-08-10
          - generic [ref=e1188]:
            - generic [ref=e1189]:
              - generic [ref=e1190]: Member
              - link "Kevin Hern" [ref=e1191] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1192]:
              - generic [ref=e1193]: Ticker
              - link "CMCSA" [ref=e1194] [cursor=pointer]:
                - /url: /tickers/CMCSA/
            - generic [ref=e1195]:
              - generic [ref=e1196]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1197]:
                - text: · JT
                - generic [ref=e1198]: (jointly owned)
          - generic [ref=e1199]:
            - generic [ref=e1200]:
              - generic [ref=e1201]: Traded
              - generic [ref=e1202]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1203]:
              - generic [ref=e1204]: Amount
              - text: $1K–$15K
              - generic [ref=e1205]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1210] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1211]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1213] [cursor=pointer]: ☆
          - generic [ref=e1214]:
            - generic [ref=e1215]: Filed
            - text: 2026-08-10
          - generic [ref=e1216]:
            - generic [ref=e1217]:
              - generic [ref=e1218]: Member
              - link "Kevin Hern" [ref=e1219] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1220]:
              - generic [ref=e1221]: Ticker
              - link "OGN" [ref=e1222] [cursor=pointer]:
                - /url: /tickers/OGN/
            - generic [ref=e1223]:
              - generic [ref=e1224]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1225]:
                - text: · JT
                - generic [ref=e1226]: (jointly owned)
          - generic [ref=e1227]:
            - generic [ref=e1228]:
              - generic [ref=e1229]: Traded
              - generic [ref=e1230]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1231]:
              - generic [ref=e1232]: Amount
              - text: $1K–$15K
              - generic [ref=e1233]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1238] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1239]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1241] [cursor=pointer]: ☆
          - generic [ref=e1242]:
            - generic [ref=e1243]: Filed
            - text: 2026-08-10
          - generic [ref=e1244]:
            - generic [ref=e1245]:
              - generic [ref=e1246]: Member
              - link "Kevin Hern" [ref=e1247] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1248]:
              - generic [ref=e1249]: Ticker
              - link "DEO" [ref=e1250] [cursor=pointer]:
                - /url: /tickers/DEO/
            - generic [ref=e1251]:
              - generic [ref=e1252]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1253]:
                - text: · JT
                - generic [ref=e1254]: (jointly owned)
          - generic [ref=e1255]:
            - generic [ref=e1256]:
              - generic [ref=e1257]: Traded
              - generic [ref=e1258]: 08-05
              - text: 08-05 → 08-10 +5d
            - generic [ref=e1259]:
              - generic [ref=e1260]: Amount
              - text: $1K–$15K
              - generic [ref=e1261]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1266] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1267]:
          - button "Watch John J. McGuire III — saved in this browser only" [ref=e1269] [cursor=pointer]: ☆
          - generic [ref=e1270]:
            - generic [ref=e1271]: Filed
            - text: 2026-08-10
          - generic [ref=e1272]:
            - generic [ref=e1273]:
              - generic [ref=e1274]: Member
              - link "John J. McGuire III" [ref=e1275] [cursor=pointer]:
                - /url: /congress/members/M001239/
              - text: R–VA-5
            - generic [ref=e1276]:
              - generic [ref=e1277]: Ticker
              - link "PANW" [ref=e1278] [cursor=pointer]:
                - /url: /tickers/PANW/
            - generic [ref=e1279]:
              - generic [ref=e1280]: Side
              - text: Sale
              - generic "partial sale, spouse-owned" [ref=e1281]:
                - text: · partial · SP
                - generic [ref=e1282]: (partial sale, spouse-owned)
          - generic [ref=e1283]:
            - generic [ref=e1284]:
              - generic [ref=e1285]: Traded
              - generic [ref=e1286]: 07-31
              - text: 07-31 → 08-10 +10d
            - generic [ref=e1287]:
              - generic [ref=e1288]: Amount
              - text: $1K–$15K
              - generic [ref=e1289]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1294] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035180.pdf
              - text: PTR ↗
        - listitem [ref=e1295]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1297] [cursor=pointer]: ☆
          - generic [ref=e1298]:
            - generic [ref=e1299]: Filed
            - text: 2026-08-10
          - generic [ref=e1300]:
            - generic [ref=e1301]:
              - generic [ref=e1302]: Member
              - link "Kevin Hern" [ref=e1303] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1304]:
              - generic [ref=e1305]: Ticker
              - 'generic "TULSA CNTY OKLA INDPT SCH DIST NO 02.00000% 09/01/2026 [GS] · asset type as filed: GS" [ref=e1306]':
                - text: TULSA CNTY OKLA INDPT SCH DIST NO 02.…
                - generic [ref=e1307]: "TULSA CNTY OKLA INDPT SCH DIST NO 02.00000% 09/01/2026 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1308]:
              - generic [ref=e1309]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1310]:
                - text: · JT
                - generic [ref=e1311]: (jointly owned)
          - generic [ref=e1312]:
            - generic [ref=e1313]:
              - generic [ref=e1314]: Traded
              - generic [ref=e1315]: 07-24
              - text: 07-24 → 08-10 +17d
            - generic [ref=e1316]:
              - generic [ref=e1317]: Amount
              - text: $100K–$250K
              - generic [ref=e1318]: $100K–$250K
            - generic [ref=e1319]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1324] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1325]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1327] [cursor=pointer]: ☆
          - generic [ref=e1328]:
            - generic [ref=e1329]: Filed
            - text: 2026-08-10
          - generic [ref=e1330]:
            - generic [ref=e1331]:
              - generic [ref=e1332]: Member
              - link "Kevin Hern" [ref=e1333] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1334]:
              - generic [ref=e1335]: Ticker
              - 'generic "CADDO CNTY OKLA GOVERNMENTAL BLDG 05.00000% 09/01/2030 [GS] · asset type as filed: GS" [ref=e1336]':
                - text: CADDO CNTY OKLA GOVERNMENTAL BLDG 05.…
                - generic [ref=e1337]: "CADDO CNTY OKLA GOVERNMENTAL BLDG 05.00000% 09/01/2030 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1338]:
              - generic [ref=e1339]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1340]:
                - text: · JT
                - generic [ref=e1341]: (jointly owned)
          - generic [ref=e1342]:
            - generic [ref=e1343]:
              - generic [ref=e1344]: Traded
              - generic [ref=e1345]: 07-24
              - text: 07-24 → 08-10 +17d
            - generic [ref=e1346]:
              - generic [ref=e1347]: Amount
              - text: $50K–$100K
              - generic [ref=e1348]: $50K–$100K
            - generic [ref=e1349]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1354] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1355]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1357] [cursor=pointer]: ☆
          - generic [ref=e1358]:
            - generic [ref=e1359]: Filed
            - text: 2026-08-10
          - generic [ref=e1360]:
            - generic [ref=e1361]:
              - generic [ref=e1362]: Member
              - link "Josh Gottheimer" [ref=e1363] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1364]:
              - generic [ref=e1365]: Ticker
              - link "GOOGM" [ref=e1366] [cursor=pointer]:
                - /url: /tickers/GOOGM/
            - generic [ref=e1367]:
              - generic [ref=e1368]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1369]:
                - text: · JT
                - generic [ref=e1370]: (jointly owned)
          - generic [ref=e1371]:
            - generic [ref=e1372]:
              - generic [ref=e1373]: Traded
              - generic [ref=e1374]: 07-24
              - text: 07-24 → 08-10 +17d
            - generic [ref=e1375]:
              - generic [ref=e1376]: Amount
              - text: $1K–$15K
              - generic [ref=e1377]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1382] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1383]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1385] [cursor=pointer]: ☆
          - generic [ref=e1386]:
            - generic [ref=e1387]: Filed
            - text: 2026-08-10
          - generic [ref=e1388]:
            - generic [ref=e1389]:
              - generic [ref=e1390]: Member
              - link "Josh Gottheimer" [ref=e1391] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1392]:
              - generic [ref=e1393]: Ticker
              - link "GOOGN" [ref=e1394] [cursor=pointer]:
                - /url: /tickers/GOOGN/
            - generic [ref=e1395]:
              - generic [ref=e1396]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1397]:
                - text: · JT
                - generic [ref=e1398]: (jointly owned)
          - generic [ref=e1399]:
            - generic [ref=e1400]:
              - generic [ref=e1401]: Traded
              - generic [ref=e1402]: 07-24
              - text: 07-24 → 08-10 +17d
            - generic [ref=e1403]:
              - generic [ref=e1404]: Amount
              - text: $1K–$15K
              - generic [ref=e1405]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1410] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1411]:
          - button "Watch John Fetterman — saved in this browser only" [ref=e1413] [cursor=pointer]: ☆
          - generic [ref=e1414]:
            - generic [ref=e1415]: Filed
            - text: 2026-08-10
          - generic [ref=e1416]:
            - generic [ref=e1417]:
              - generic [ref=e1418]: Member
              - link "John Fetterman" [ref=e1419] [cursor=pointer]:
                - /url: /congress/members/F000479/
              - text: D–PA
            - generic [ref=e1420]:
              - generic [ref=e1421]: Ticker
              - 'generic "Freeport McMoran · asset type as filed: Corporate Bond" [ref=e1422]':
                - text: Freeport McMoran
                - generic [ref=e1423]: "Freeport McMoran — asset type as filed: Corporate Bond — asset as filed, no ticker disclosed"
            - generic [ref=e1424]:
              - generic [ref=e1425]: Side
              - text: Sale
              - generic "dependent-child-owned" [ref=e1426]:
                - text: · DC
                - generic [ref=e1427]: (dependent-child-owned)
          - generic [ref=e1428]:
            - generic [ref=e1429]:
              - generic [ref=e1430]: Traded
              - generic [ref=e1431]: 07-24
              - text: 07-24 → 08-10 +17d
            - generic [ref=e1432]:
              - generic [ref=e1433]: Amount
              - text: $1K–$15K
              - generic [ref=e1434]: $1K–$15K
            - generic [ref=e1435]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e1440] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/c993b04b-6773-47e2-9b61-ab5dfe9e68b1/
              - text: eFD ↗
        - listitem [ref=e1441]:
          - button "Watch John Fetterman — saved in this browser only" [ref=e1443] [cursor=pointer]: ☆
          - generic [ref=e1444]:
            - generic [ref=e1445]: Filed
            - text: 2026-08-10
          - generic [ref=e1446]:
            - generic [ref=e1447]:
              - generic [ref=e1448]: Member
              - link "John Fetterman" [ref=e1449] [cursor=pointer]:
                - /url: /congress/members/F000479/
              - text: D–PA
            - generic [ref=e1450]:
              - generic [ref=e1451]: Ticker
              - 'generic "Hasbro Inc Note · asset type as filed: Corporate Bond" [ref=e1452]':
                - text: Hasbro Inc Note
                - generic [ref=e1453]: "Hasbro Inc Note — asset type as filed: Corporate Bond — asset as filed, no ticker disclosed"
            - generic [ref=e1454]:
              - generic [ref=e1455]: Side
              - text: Sale
              - generic "dependent-child-owned" [ref=e1456]:
                - text: · DC
                - generic [ref=e1457]: (dependent-child-owned)
          - generic [ref=e1458]:
            - generic [ref=e1459]:
              - generic [ref=e1460]: Traded
              - generic [ref=e1461]: 07-24
              - text: 07-24 → 08-10 +17d
            - generic [ref=e1462]:
              - generic [ref=e1463]: Amount
              - text: $1K–$15K
              - generic [ref=e1464]: $1K–$15K
            - generic [ref=e1465]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e1470] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/c993b04b-6773-47e2-9b61-ab5dfe9e68b1/
              - text: eFD ↗
        - listitem [ref=e1471]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1473] [cursor=pointer]: ☆
          - generic [ref=e1474]:
            - generic [ref=e1475]: Filed
            - text: 2026-08-10
          - generic [ref=e1476]:
            - generic [ref=e1477]:
              - generic [ref=e1478]: Member
              - link "Josh Gottheimer" [ref=e1479] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1480]:
              - generic [ref=e1481]: Ticker
              - link "CCI" [ref=e1482] [cursor=pointer]:
                - /url: /tickers/CCI/
            - generic [ref=e1483]:
              - generic [ref=e1484]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1485]:
                - text: · JT
                - generic [ref=e1486]: (jointly owned)
          - generic [ref=e1487]:
            - generic [ref=e1488]:
              - generic [ref=e1489]: Traded
              - generic [ref=e1490]: 07-23
              - text: 07-23 → 08-10 +18d
            - generic [ref=e1491]:
              - generic [ref=e1492]: Amount
              - text: $1K–$15K
              - generic [ref=e1493]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1498] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1499]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1501] [cursor=pointer]: ☆
          - generic [ref=e1502]:
            - generic [ref=e1503]: Filed
            - text: 2026-08-10
          - generic [ref=e1504]:
            - generic [ref=e1505]:
              - generic [ref=e1506]: Member
              - link "Josh Gottheimer" [ref=e1507] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1508]:
              - generic [ref=e1509]: Ticker
              - link "GOOGN" [ref=e1510] [cursor=pointer]:
                - /url: /tickers/GOOGN/
            - generic [ref=e1511]:
              - generic [ref=e1512]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1513]:
                - text: · JT
                - generic [ref=e1514]: (jointly owned)
          - generic [ref=e1515]:
            - generic [ref=e1516]:
              - generic [ref=e1517]: Traded
              - generic [ref=e1518]: 07-23
              - text: 07-23 → 08-10 +18d
            - generic [ref=e1519]:
              - generic [ref=e1520]: Amount
              - text: $1K–$15K
              - generic [ref=e1521]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1526] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1527]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1529] [cursor=pointer]: ☆
          - generic [ref=e1530]:
            - generic [ref=e1531]: Filed
            - text: 2026-08-10
          - generic [ref=e1532]:
            - generic [ref=e1533]:
              - generic [ref=e1534]: Member
              - link "Kevin Hern" [ref=e1535] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1536]:
              - generic [ref=e1537]: Ticker
              - 'generic "KINGFISHER CNTY OKLA EDL FACS AUTH EDL 03.00000% 03/01/2031 [GS] · asset type as filed: GS" [ref=e1538]':
                - text: KINGFISHER CNTY OKLA EDL FACS AUTH ED…
                - generic [ref=e1539]: "KINGFISHER CNTY OKLA EDL FACS AUTH EDL 03.00000% 03/01/2031 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1540]:
              - generic [ref=e1541]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1542]:
                - text: · JT
                - generic [ref=e1543]: (jointly owned)
          - generic [ref=e1544]:
            - generic [ref=e1545]:
              - generic [ref=e1546]: Traded
              - generic [ref=e1547]: 07-20
              - text: 07-20 → 08-10 +21d
            - generic [ref=e1548]:
              - generic [ref=e1549]: Amount
              - text: $100K–$250K
              - generic [ref=e1550]: $100K–$250K
            - generic [ref=e1551]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1556] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
      - generic [ref=e1557]:
        - text: † filer not yet joined to a member record — name as printed on the filing
        - code [ref=e1558]: bioguide_id=null
        - text: ‡ Senate spouse amounts above $1M print only as "Over $1,000,000"
        - code [ref=e1559]: amount_spouse_cap
      - generic [ref=e1560]:
        - generic [ref=e1561]:
          - text: v_default_transactions — active filings minus superseded amendment originals ·
          - link "what's excluded ↗" [ref=e1562] [cursor=pointer]:
            - /url: /methodology/#defaults
        - generic [ref=e1563]:
          - generic [ref=e1564]: 1–50 of 71,714 transactions · 3,047 paper filings (2 here)
          - button "← newer" [disabled] [ref=e1565]
          - button "older →" [ref=e1566] [cursor=pointer]
      - status [ref=e1567]
  - contentinfo [ref=e1568]:
    - generic [ref=e1569]:
      - generic [ref=e1570]:
        - strong [ref=e1571]: Prohibited uses.
        - text: Use of congressional financial-disclosure reports for commercial purposes, for determining credit, or for solicitation is restricted by 5 U.S.C. § 13107(c). Public Filings republishes these public records for transparency and research. Nothing here is financial advice.
      - generic [ref=e1572]:
        - strong [ref=e1573]: Sources.
        - text: "House Clerk PTR · Senate eFD · SEC EDGAR · congress-legislators (CC0) · kadoa seed (MIT). Per-source conditions:"
        - link "DATA-LICENSE ↗" [ref=e1574] [cursor=pointer]:
          - /url: /legal/DATA-LICENSE.md
        - text: ·
        - link "NOTICE ↗" [ref=e1575] [cursor=pointer]:
          - /url: /legal/NOTICE.txt
      - generic [ref=e1576]: build 20260817.1 · code 318dea5f8e23952fd6ed8e23de5c13aef85dc7ddno cookies · no account required · no tracking
```

# Test source

```ts
  1   | /* R35 — layout defects verified by REAL browser geometry, at five widths.
  2   | 
  3   |    Every other test in this repo can only see markup or CSS text. A rule that
  4   |    exists is not the claim being made here; the claim is that two boxes do not
  5   |    occupy the same pixels. R4, R5, R7 and R9 are all defined against rendered
  6   |    geometry precisely because their defects were invisible to markup tests —
  7   |    the masthead collided for months while every DOM assertion passed.
  8   | 
  9   |    These must FAIL on a reintroduced overlap. `layout-negative.spec.ts` proves
  10  |    that by injecting one. */
  11  | 
  12  | import { test, expect, type Page, type Locator } from "@playwright/test";
  13  | import { WIDTHS } from "../../playwright.config.ts";
  14  | 
  15  | interface Box { x: number; y: number; width: number; height: number }
  16  | 
  17  | const overlap = (a: Box, b: Box): number => {
  18  |   const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  19  |   const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  20  |   return w > 0 && h > 0 ? w * h : 0;
  21  | };
  22  | 
  23  | /** Visible boxes only — a `display:none` burger has no geometry to protect. */
  24  | async function boxesOf(page: Page, selectors: string[]): Promise<{ sel: string; box: Box }[]> {
  25  |   const out: { sel: string; box: Box }[] = [];
  26  |   for (const sel of selectors) {
  27  |     const el: Locator = page.locator(sel).first();
  28  |     if ((await el.count()) === 0) continue;
  29  |     if (!(await el.isVisible())) continue;
  30  |     const box = await el.boundingBox();
  31  |     if (box && box.width > 0 && box.height > 0) out.push({ sel, box });
  32  |   }
  33  |   return out;
  34  | }
  35  | 
  36  | for (const width of WIDTHS) {
  37  |   test.describe(`@${width}px`, () => {
  38  |     test.beforeEach(async ({ page }) => {
  39  |       await page.setViewportSize({ width, height: 900 });
  40  |     });
  41  | 
  42  |     test("R4: no two masthead elements occupy the same pixels", async ({ page }) => {
  43  |       await page.goto("/");
  44  |       const parts = await boxesOf(page, [
  45  |         ".brand",
  46  |         ".site-nav",
  47  |         ".site-search",
  48  |         ".theme-toggle",
  49  |         ".nav-burger",
  50  |         ".search-toggle",
  51  |       ]);
  52  |       expect(parts.length, "the masthead rendered something to measure").toBeGreaterThan(1);
  53  |       for (let i = 0; i < parts.length; i++) {
  54  |         for (let j = i + 1; j < parts.length; j++) {
  55  |           const a = parts[i]!, b = parts[j]!;
  56  |           expect(
  57  |             overlap(a.box, b.box),
  58  |             `${a.sel} and ${b.sel} intersect at ${width}px — the masthead is painting over itself`,
  59  |           ).toBe(0);
  60  |         }
  61  |       }
  62  |     });
  63  | 
  64  |     test("R4: exactly one build watermark, and it is in the footer", async ({ page }) => {
  65  |       await page.goto("/");
  66  |       const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  67  |       const ids = body.match(/build \d{8}\.\d+/g) ?? [];
  68  |       expect(ids.length, `build id renders ${ids.length} times, expected 1`).toBe(1);
  69  |       const inFooter = await page.locator("footer").innerText();
  70  |       expect(inFooter).toContain(ids[0]!);
  71  |     });
  72  | 
  73  |     test("nothing overflows the page horizontally", async ({ page }) => {
  74  |       await page.goto("/congress/");
  75  |       /* Name the culprit. "The page is 200px too wide" sends the reader
  76  |          hunting; "this element's right edge is at 1164" does not. */
  77  |       const diag = await page.evaluate(() => {
  78  |         const limit = window.innerWidth;
  79  |         let worst: { sel: string; right: number } | null = null;
  80  |         for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
  81  |           const r = el.getBoundingClientRect();
  82  |           if (r.width === 0 || r.height === 0) continue;
  83  |           const cs = getComputedStyle(el);
  84  |           if (cs.position === "fixed") continue;
  85  |           const right = r.right + window.scrollX;
  86  |           if (right > limit + 1 && (!worst || right > worst.right)) {
  87  |             const id = el.id ? `#${el.id}` : "";
  88  |             const cls = el.className && typeof el.className === "string"
  89  |               ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
  90  |               : "";
  91  |             worst = { sel: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(right) };
  92  |           }
  93  |         }
  94  |         return { over: document.documentElement.scrollWidth - limit, limit, worst };
  95  |       });
  96  |       expect(
  97  |         diag.over,
  98  |         `the page scrolls sideways by ${diag.over}px at ${width}px — widest offender: ` +
  99  |           `${diag.worst?.sel ?? "unknown"} reaching x=${diag.worst?.right} against a ${diag.limit}px viewport`,
> 100 |       ).toBeLessThanOrEqual(1);
      |         ^ Error: the page scrolls sideways by 29px at 360px — widest offender: div.filter-controls reaching x=389 against a 360px viewport
  101 |     });
  102 | 
  103 |     test("R5: no feed cell paints over its neighbour", async ({ page }) => {
  104 |       await page.goto("/congress/");
  105 |       const rows = page.locator(".feed-row");
  106 |       const n = Math.min(await rows.count(), 12);
  107 |       expect(n, "the feed rendered rows to measure").toBeGreaterThan(0);
  108 |       for (let r = 0; r < n; r++) {
  109 |         const cells = rows.nth(r).locator(".cell");
  110 |         const boxes: { i: number; box: Box }[] = [];
  111 |         for (let c = 0; c < (await cells.count()); c++) {
  112 |           const el = cells.nth(c);
  113 |           if (!(await el.isVisible())) continue;
  114 |           /* Out-of-flow cells are EXCLUDED, and this is not a loophole. The
  115 |              mobile fold lifts `.cell-star` out of the grid and parks it in the
  116 |              row's top-right corner, clearing the text with `padding-right` on
  117 |              `.row-line1`. Its box legitimately overlaps its neighbours' boxes
  118 |              while no glyph ever does. Comparing it would report a collision
  119 |              that does not exist, and a check that cries wolf gets muted. */
  120 |           const flow = await el.evaluate((n) => getComputedStyle(n).position);
  121 |           if (flow === "absolute" || flow === "fixed") continue;
  122 |           const box = await el.boundingBox();
  123 |           if (box && box.width > 0) boxes.push({ i: c, box });
  124 |         }
  125 |         for (let i = 0; i < boxes.length; i++) {
  126 |           for (let j = i + 1; j < boxes.length; j++) {
  127 |             expect(
  128 |               overlap(boxes[i]!.box, boxes[j]!.box),
  129 |               `row ${r}: cells ${boxes[i]!.i} and ${boxes[j]!.i} intersect at ${width}px`,
  130 |             ).toBe(0);
  131 |           }
  132 |         }
  133 |       }
  134 |     });
  135 | 
  136 |     test("R9: the stat strip leaves no unoccupied trailing area", async ({ page }) => {
  137 |       await page.goto("/");
  138 |       const strip = page.locator(".tiles").first();
  139 |       if ((await strip.count()) === 0 || !(await strip.isVisible())) test.skip();
  140 |       const stripBox = (await strip.boundingBox())!;
  141 |       const tiles = strip.locator(".tile");
  142 |       const count = await tiles.count();
  143 |       expect(count, "a rendered strip must hold tiles").toBeGreaterThan(0);
  144 |       /* Trailing space is only meaningful on a SINGLE row. Once the strip
  145 |          wraps (R9), space after the last tile is the normal ragged end of a
  146 |          wrapped line, not the strip reserving room for data it does not have —
  147 |          asserting on it would fail a correct layout. */
  148 |       const boxes = [];
  149 |       for (let i = 0; i < count; i++) boxes.push((await tiles.nth(i).boundingBox())!);
  150 |       const rows = new Set(boxes.map((b) => Math.round(b.y)));
  151 |       if (rows.size > 1) test.skip();
  152 |       const last = boxes[count - 1]!;
  153 |       const trailing = stripBox.x + stripBox.width - (last.x + last.width);
  154 |       /* The strip is a bordered flex box; leftover space inside it reads as an
  155 |          empty tile the data does not support. A couple of px is the border. */
  156 |       expect(
  157 |         trailing,
  158 |         `${Math.round(trailing)}px of empty strip trails the last tile at ${width}px — ` +
  159 |           `the strip is claiming room for data it does not have`,
  160 |       ).toBeLessThanOrEqual(4);
  161 |     });
  162 |   });
  163 | }
  164 | 
  165 | test("R6: a scrollable table announces itself and pins its identity column", async ({ page }) => {
  166 |   await page.setViewportSize({ width: 964, height: 900 });
  167 |   await page.goto("/institutional/filers/1067983/");
  168 |   const scroller = page.locator(".table-scroll").first();
  169 |   if ((await scroller.count()) === 0) test.skip();
  170 |   const state = await scroller.evaluate((el) => ({
  171 |     scrollable: el.scrollWidth > el.clientWidth,
  172 |     background: getComputedStyle(el).backgroundImage,
  173 |   }));
  174 |   if (!state.scrollable) test.skip();
  175 |   expect(
  176 |     state.background,
  177 |     "a table that scrolls sideways with no cue hides its columns as surely as deleting them",
  178 |   ).toContain("gradient");
  179 |   const firstCell = page.locator(".etable[data-sticky-first] td:first-child").first();
  180 |   if ((await firstCell.count()) > 0) {
  181 |     expect(await firstCell.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  182 |   }
  183 | });
  184 | 
```