# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: layout.spec.ts >> @964px >> nothing overflows the page horizontally
- Location: test/geometry/layout.spec.ts:73:5

# Error details

```
Error: the page scrolls sideways by 200px at 964px — widest offender: div.tiles reaching x=1164 against a 964px viewport

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1
Received:    200
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - link "Public Filings home" [ref=e5] [cursor=pointer]:
          - /url: /
          - generic [ref=e9]: Public Filings
        - navigation "Modules" [ref=e10]:
          - link "Congress" [ref=e11] [cursor=pointer]:
            - /url: /congress/
          - link "Institutional" [ref=e12] [cursor=pointer]:
            - /url: /institutional/
          - link "Financials SOON" [ref=e13] [cursor=pointer]:
            - /url: /financials/
          - link "Macro SOON" [ref=e14] [cursor=pointer]:
            - /url: /macro/
          - link "Methodology" [ref=e15] [cursor=pointer]:
            - /url: /methodology/
      - generic [ref=e16]:
        - generic [ref=e17]:
          - generic [ref=e18]:
            - text: ⌕
            - generic [ref=e19]: Search tickers, members, and filers
          - combobox "Search tickers, members, and filers" [ref=e20]
          - generic [ref=e21]: /
        - button "Switch to dark theme" [ref=e22] [cursor=pointer]: ☾ dark
  - main [ref=e23]:
    - generic [ref=e24]:
      - generic [ref=e25]:
        - generic [ref=e26]: /congress
        - heading "Congressional trading" [level=1] [ref=e27]
        - paragraph [ref=e28]:
          - text: Periodic Transaction Reports from the House Clerk and Senate eFD. Amounts are disclosed in statutory ranges and filed up to 45 days after the trade — what you read here is what was filed; nothing more current exists in the public record.
          - link "How this data is made ↗" [ref=e29] [cursor=pointer]:
            - /url: /methodology/
      - list "Data coverage" [ref=e30]:
        - listitem "transactions in the default view (active filings minus superseded amendment originals). Counts filings made in this window; disclosed trade dates can be earlier." [ref=e31]:
          - generic [ref=e32]: 71,714
          - generic [ref=e33]: rows filed since 2014
        - listitem "fully parsed 5532 of 5892 e-filed House PTRs; 360 partial. A further 2445 of 8337 total House filings are paper and not machine-readable — excluded from this denominator and counted in the paper tile." [ref=e35]:
          - generic [ref=e36]: 93.8%
          - generic [ref=e37]: House parse · 5892 e-filed
        - listitem "fully parsed 1809 of 1809 e-filed Senate PTRs; 0 partial. A further 602 of 2411 total Senate filings are paper and not machine-readable — excluded from this denominator and counted in the paper tile." [ref=e39]:
          - generic [ref=e40]: 100%
          - generic [ref=e41]: Senate parse · 1809 e-filed
        - listitem "filings submitted on paper — retained and counted in filing totals with zero transaction rows, not yet machine-readable. Excluded from the parse denominators above, which count e-filed filings only." [ref=e43]:
          - generic [ref=e44]: "3047"
          - generic [ref=e45]: paper · need OCR · 2445 H · 602 S
    - navigation "Congress views" [ref=e47]:
      - generic [ref=e48]: Feed
      - link "Leaders" [ref=e49] [cursor=pointer]:
        - /url: /congress/leaders/
      - link "Tickers" [ref=e50] [cursor=pointer]:
        - /url: /congress/tickers/
    - generic [ref=e51]:
      - generic [ref=e52]:
        - group "Chamber" [ref=e53]:
          - generic [ref=e55]:
            - button "All" [pressed] [ref=e56] [cursor=pointer]
            - button "House" [ref=e57] [cursor=pointer]
            - button "Senate" [ref=e58] [cursor=pointer]
        - group "Party" [ref=e59]:
          - generic [ref=e61]:
            - button "All" [pressed] [ref=e62] [cursor=pointer]
            - button "Democratic" [ref=e63] [cursor=pointer]: D
            - button "Republican" [ref=e64] [cursor=pointer]: R
            - button "Independent" [ref=e65] [cursor=pointer]: I
        - group "Side" [ref=e66]:
          - generic [ref=e68]:
            - button "All" [pressed] [ref=e69] [cursor=pointer]
            - button "Purchase" [ref=e70] [cursor=pointer]
            - button "Sale" [ref=e71] [cursor=pointer]
            - button "Exch." [ref=e72] [cursor=pointer]
        - generic [ref=e73]:
          - generic [ref=e74]: Amount ≥
          - combobox "Amount ≥" [ref=e75] [cursor=pointer]:
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
        - generic [ref=e76]:
          - generic [ref=e77]: Owner
          - combobox "Owner" [ref=e78] [cursor=pointer]:
            - option "all" [selected]
            - option "self"
            - option "spouse (SP)"
            - option "child (DC)"
            - option "joint (JT)"
            - option "not stated"
        - generic [ref=e79] [cursor=pointer]:
          - checkbox "late filings only" [ref=e80]
          - text: late only
        - generic [ref=e81] [cursor=pointer]:
          - checkbox "watched members and tickers only — stored in this browser" [ref=e82]
          - text: watched only ·
          - link "watchlist ↗" [ref=e83]:
            - /url: /watchlist/
        - generic [ref=e84]:
          - generic [ref=e85]: Filter
          - searchbox "filter by ticker prefix or member name — on this device" [ref=e86] [cursor=pointer]
        - generic [ref=e87]:
          - generic [ref=e88]: Dates
          - combobox "date basis for the range filter" [ref=e89] [cursor=pointer]:
            - option "filed" [selected]
            - option "traded"
          - textbox "from date" [ref=e90] [cursor=pointer]
          - generic [ref=e91]: –
          - textbox "to date" [ref=e92] [cursor=pointer]
        - generic [ref=e93]:
          - generic [ref=e94]: Sort
          - combobox "Sort" [ref=e95] [cursor=pointer]:
            - option "newest filed" [selected]
            - option "amount — largest lower bound"
            - option "amount — smallest lower bound"
      - generic [ref=e96]:
        - text: 1–50 of 71,714 transactions · 3,047 paper filings (2 here) · filtered on this device
        - generic [ref=e97]:
          - text: ·
          - button "reset" [ref=e98] [cursor=pointer]
    - generic [ref=e99]:
      - generic [ref=e100]:
        - generic [ref=e102]: Filed ▾
        - generic [ref=e103]: Member
        - generic [ref=e104]: Ticker
        - generic [ref=e105]: Side · Owner
        - generic [ref=e106]: Traded · Lag
        - generic [ref=e107]: Amount
        - generic [ref=e108]: Range · Flags
        - generic [ref=e109]: Src
      - list "Disclosed transactions" [ref=e110]:
        - listitem [ref=e111]:
          - button "Watch Mark R. Warner — saved in this browser only" [ref=e113] [cursor=pointer]: ☆
          - generic [ref=e114]:
            - generic [ref=e115]: Filed
            - text: 2026-08-14
          - generic [ref=e116]:
            - generic [ref=e117]:
              - generic [ref=e118]: Member
              - link "Mark R. Warner" [ref=e119] [cursor=pointer]:
                - /url: /congress/members/W000805/
              - text: D–VA
            - generic [ref=e120]:
              - generic [ref=e121]: Ticker
              - 'generic "Manassas VA GO Public Improvement Refunding Bonds · asset type as filed: Municipal Security" [ref=e122]':
                - text: Manassas VA GO Public Improvement Ref…
                - generic [ref=e123]: "Manassas VA GO Public Improvement Refunding Bonds — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e124]:
              - generic [ref=e125]: Side
              - text: Purchase
          - generic [ref=e126]:
            - generic [ref=e127]:
              - generic [ref=e128]: Traded
              - text: 07-07 +38d
            - generic [ref=e129]:
              - generic [ref=e130]: Amount
              - text: $50K–$100K
              - generic [ref=e131]: $50K–$100K
            - generic [ref=e132]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e137] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/047c4167-e0a9-44d4-a2bf-5477eb6b20ab/
              - text: eFD ↗
        - listitem [ref=e138]:
          - button "Watch Mark R. Warner — saved in this browser only" [ref=e140] [cursor=pointer]: ☆
          - generic [ref=e141]:
            - generic [ref=e142]: Filed
            - text: 2026-08-14
          - generic [ref=e143]:
            - generic [ref=e144]:
              - generic [ref=e145]: Member
              - link "Mark R. Warner" [ref=e146] [cursor=pointer]:
                - /url: /congress/members/W000805/
              - text: D–VA
            - generic [ref=e147]:
              - generic [ref=e148]: Ticker
              - 'generic "Virginia Beach VA GO Public Improvement Bonds · asset type as filed: Municipal Security" [ref=e149]':
                - text: Virginia Beach VA GO Public Improveme…
                - generic [ref=e150]: "Virginia Beach VA GO Public Improvement Bonds — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e151]:
              - generic [ref=e152]: Side
              - text: Purchase
          - generic [ref=e153]:
            - generic [ref=e154]:
              - generic [ref=e155]: Traded
              - text: 07-02 +43d
            - generic [ref=e156]:
              - generic [ref=e157]: Amount
              - text: $100K–$250K
              - generic [ref=e158]: $100K–$250K
            - generic [ref=e159]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e164] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/047c4167-e0a9-44d4-a2bf-5477eb6b20ab/
              - text: eFD ↗
        - listitem [ref=e165]:
          - button "Watch Mark R. Warner — saved in this browser only" [ref=e167] [cursor=pointer]: ☆
          - generic [ref=e168]:
            - generic [ref=e169]: Filed
            - text: 2026-08-14
          - generic [ref=e170]:
            - generic [ref=e171]:
              - generic [ref=e172]: Member
              - link "Mark R. Warner" [ref=e173] [cursor=pointer]:
                - /url: /congress/members/W000805/
              - text: D–VA
            - generic [ref=e174]:
              - generic [ref=e175]: Ticker
              - 'generic "Alexandria VA GO Capital Improvement Bonds · asset type as filed: Municipal Security" [ref=e176]':
                - text: Alexandria VA GO Capital Improvement …
                - generic [ref=e177]: "Alexandria VA GO Capital Improvement Bonds — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e178]:
              - generic [ref=e179]: Side
              - text: Purchase
          - generic [ref=e180]:
            - generic [ref=e181]:
              - generic [ref=e182]: Traded
              - text: 07-02 +43d
            - generic [ref=e183]:
              - generic [ref=e184]: Amount
              - text: $50K–$100K
              - generic [ref=e185]: $50K–$100K
            - generic [ref=e186]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e191] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/047c4167-e0a9-44d4-a2bf-5477eb6b20ab/
              - text: eFD ↗
        - listitem [ref=e192]:
          - button "Watch William R. Keating — saved in this browser only" [ref=e194] [cursor=pointer]: ☆
          - generic [ref=e195]:
            - generic [ref=e196]: Filed
            - text: 2026-08-13
          - generic [ref=e197]:
            - generic [ref=e198]:
              - generic [ref=e199]: Member
              - link "William R. Keating" [ref=e200] [cursor=pointer]:
                - /url: /congress/members/K000375/
              - text: D–MA-9
            - generic [ref=e201]:
              - generic [ref=e202]: Ticker
              - 'generic "CAPITAL ONE FINL CORP NOTE 7.62400% 10/30/2031 [CS] · asset type as filed: CS" [ref=e203]':
                - text: CAPITAL ONE FINL CORP NOTE 7.62400% 1…
                - generic [ref=e204]: "CAPITAL ONE FINL CORP NOTE 7.62400% 10/30/2031 [CS] — asset type as filed: CS — asset as filed, no ticker disclosed"
            - generic [ref=e205]:
              - generic [ref=e206]: Side
              - text: Purchase
          - generic [ref=e207]:
            - generic [ref=e208]:
              - generic [ref=e209]: Traded
              - text: 06-30 +44d
            - generic [ref=e210]:
              - generic [ref=e211]: Amount
              - text: $1K–$15K
              - generic [ref=e212]: $1K–$15K
            - generic [ref=e213]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e218] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034898.pdf
              - text: PTR ↗
        - listitem [ref=e219]:
          - button "Watch William R. Keating — saved in this browser only" [ref=e221] [cursor=pointer]: ☆
          - generic [ref=e222]:
            - generic [ref=e223]: Filed
            - text: 2026-08-13
          - generic [ref=e224]:
            - generic [ref=e225]:
              - generic [ref=e226]: Member
              - link "William R. Keating" [ref=e227] [cursor=pointer]:
                - /url: /congress/members/K000375/
              - text: D–MA-9
            - generic [ref=e228]:
              - generic [ref=e229]: Ticker
              - 'generic "HCA INC. NOTE CALL MAKE WHOLE 5.62500% 09/01/2028 [CS] · asset type as filed: CS" [ref=e230]':
                - text: HCA INC. NOTE CALL MAKE WHOLE 5.62500…
                - generic [ref=e231]: "HCA INC. NOTE CALL MAKE WHOLE 5.62500% 09/01/2028 [CS] — asset type as filed: CS — asset as filed, no ticker disclosed"
            - generic [ref=e232]:
              - generic [ref=e233]: Side
              - text: Purchase
          - generic [ref=e234]:
            - generic [ref=e235]:
              - generic [ref=e236]: Traded
              - text: 06-30 +44d
            - generic [ref=e237]:
              - generic [ref=e238]: Amount
              - text: $15K–$50K
              - generic [ref=e239]: $15K–$50K
            - generic [ref=e240]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e245] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034898.pdf
              - text: PTR ↗
        - listitem [ref=e246]:
          - button "Watch Shri Thanedar — saved in this browser only" [ref=e248] [cursor=pointer]: ☆
          - generic [ref=e249]:
            - generic [ref=e250]: Filed
            - text: 2026-08-13
          - generic [ref=e251]:
            - generic [ref=e252]:
              - generic [ref=e253]: Member
              - link "Shri Thanedar" [ref=e254] [cursor=pointer]:
                - /url: /congress/members/T000488/
              - text: D–MI-13
            - generic [ref=e255]:
              - generic [ref=e256]: Ticker
              - link "AAPL" [ref=e257] [cursor=pointer]:
                - /url: /tickers/AAPL/
            - generic [ref=e258]:
              - generic [ref=e259]: Side
              - text: Sale
              - generic "partial sale" [ref=e260]:
                - text: · partial
                - generic [ref=e261]: (partial sale)
          - generic [ref=e262]:
            - generic [ref=e263]:
              - generic [ref=e264]: Traded
              - text: 01-09
              - generic [ref=e265]: LATE·216d
            - generic [ref=e266]:
              - generic [ref=e267]: Amount
              - text: $100K–$250K
              - generic [ref=e268]: $100K–$250K
            - link "source document (PTR) — opens in a new tab" [ref=e273] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033910.pdf
              - text: PTR ↗
        - listitem [ref=e274]:
          - button [disabled] [ref=e276]: ☆
          - generic [ref=e277]:
            - generic [ref=e278]: Filed
            - text: 2026-08-13
          - generic [ref=e279]:
            - generic [ref=e280]:
              - generic [ref=e281]: Member
              - link "Sheehy, Timothy P" [ref=e282] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e283]: †
              - text: —
            - generic [ref=e284]:
              - generic [ref=e285]: Ticker
              - 'generic "Max Ventures New World Opportunities Fund LP - Sana Labs AB · asset type as filed: Non-Public Stock" [ref=e286]':
                - text: Max Ventures New World Opportunities …
                - generic [ref=e287]: "Max Ventures New World Opportunities Fund LP - Sana Labs AB — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e288]:
              - generic [ref=e289]: Side
              - text: Sale
          - generic [ref=e290]:
            - generic [ref=e291]:
              - generic [ref=e292]: Traded
              - text: 2025-11-04
              - generic [ref=e293]: LATE·282d
            - generic [ref=e294]:
              - generic [ref=e295]: Amount
              - text: $50K–$100K
              - generic [ref=e296]: $50K–$100K
            - generic [ref=e297]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e302] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e303]:
          - button [disabled] [ref=e305]: ☆
          - generic [ref=e306]:
            - generic [ref=e307]: Filed
            - text: 2026-08-13
          - generic [ref=e308]:
            - generic [ref=e309]:
              - generic [ref=e310]: Member
              - link "Sheehy, Timothy P" [ref=e311] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e312]: †
              - text: —
            - generic [ref=e313]:
              - generic [ref=e314]: Ticker
              - 'generic "WCAS XIV Co-Investors LLC - Grant Street Group · asset type as filed: Non-Public Stock" [ref=e315]':
                - text: WCAS XIV Co-Investors LLC - Grant Str…
                - generic [ref=e316]: "WCAS XIV Co-Investors LLC - Grant Street Group — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e317]:
              - generic [ref=e318]: Side
              - text: Purchase
          - generic [ref=e319]:
            - generic [ref=e320]:
              - generic [ref=e321]: Traded
              - text: 2025-11-03
              - generic [ref=e322]: LATE·283d
            - generic [ref=e323]:
              - generic [ref=e324]: Amount
              - text: $1K–$15K
              - generic [ref=e325]: $1K–$15K
            - generic [ref=e326]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e331] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e332]:
          - button "Watch Shri Thanedar — saved in this browser only" [ref=e334] [cursor=pointer]: ☆
          - generic [ref=e335]:
            - generic [ref=e336]: Filed
            - text: 2026-08-13
          - generic [ref=e337]:
            - generic [ref=e338]:
              - generic [ref=e339]: Member
              - link "Shri Thanedar" [ref=e340] [cursor=pointer]:
                - /url: /congress/members/T000488/
              - text: D–MI-13
            - generic [ref=e341]:
              - generic [ref=e342]: Ticker
              - link "MSTR" [ref=e343] [cursor=pointer]:
                - /url: /tickers/MSTR/
            - generic [ref=e344]:
              - generic [ref=e345]: Side
              - text: Sale
          - generic [ref=e346]:
            - generic [ref=e347]:
              - generic [ref=e348]: Traded
              - text: 2025-10-21
              - generic [ref=e349]: LATE·296d
            - generic [ref=e350]:
              - generic [ref=e351]: Amount
              - text: $15K–$50K
              - generic [ref=e352]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e357] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033910.pdf
              - text: PTR ↗
        - listitem [ref=e358]:
          - button "Watch Derek Tran — saved in this browser only" [ref=e360] [cursor=pointer]: ☆
          - generic [ref=e361]:
            - generic [ref=e362]: Filed
            - text: 2026-08-13
          - generic [ref=e363]:
            - generic [ref=e364]:
              - generic [ref=e365]: Member
              - link "Derek Tran" [ref=e366] [cursor=pointer]:
                - /url: /congress/members/T000491/
              - text: D–CA-45
            - generic [ref=e367]:
              - generic [ref=e368]: Ticker
              - link "LTC" [ref=e369] [cursor=pointer]:
                - /url: /tickers/LTC/
            - generic [ref=e370]:
              - generic [ref=e371]: Side
              - text: Sale
          - generic [ref=e372]:
            - generic [ref=e373]:
              - generic [ref=e374]: Traded
              - text: 2025-07-28
              - generic [ref=e375]: LATE·381d
            - generic [ref=e376]:
              - generic [ref=e377]: Amount
              - text: $1K–$15K
              - generic [ref=e378]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e383] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035183.pdf
              - text: PTR ↗
        - listitem [ref=e384]:
          - button [disabled] [ref=e386]: ☆
          - generic [ref=e387]:
            - generic [ref=e388]: Filed
            - text: 2026-08-13
          - generic [ref=e389]:
            - generic [ref=e390]:
              - generic [ref=e391]: Member
              - link "Sheehy, Timothy P" [ref=e392] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e393]: †
              - text: —
            - generic [ref=e394]:
              - generic [ref=e395]: Ticker
              - 'generic "WCAS XIV Co-Investors LLC - AIA Contract Documents · asset type as filed: Non-Public Stock" [ref=e396]':
                - text: WCAS XIV Co-Investors LLC - AIA Contr…
                - generic [ref=e397]: "WCAS XIV Co-Investors LLC - AIA Contract Documents — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e398]:
              - generic [ref=e399]: Side
              - text: Purchase
          - generic [ref=e400]:
            - generic [ref=e401]:
              - generic [ref=e402]: Traded
              - text: 2025-07-08
              - generic [ref=e403]: LATE·401d
            - generic [ref=e404]:
              - generic [ref=e405]: Amount
              - text: $1K–$15K
              - generic [ref=e406]: $1K–$15K
            - generic [ref=e407]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e412] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e413]:
          - button [disabled] [ref=e415]: ☆
          - generic [ref=e416]:
            - generic [ref=e417]: Filed
            - text: 2026-08-13
          - generic [ref=e418]:
            - generic [ref=e419]:
              - generic [ref=e420]: Member
              - link "Sheehy, Timothy P" [ref=e421] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e422]: †
              - text: —
            - generic [ref=e423]:
              - generic [ref=e424]: Ticker
              - 'generic "Ansett Aerospace Holdings LLC - Regaero Holdings Pty Ltd · asset type as filed: Non-Public Stock" [ref=e425]':
                - text: Ansett Aerospace Holdings LLC - Regae…
                - generic [ref=e426]: "Ansett Aerospace Holdings LLC - Regaero Holdings Pty Ltd — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e427]:
              - generic [ref=e428]: Side
              - text: Sale
          - generic [ref=e429]:
            - generic [ref=e430]:
              - generic [ref=e431]: Traded
              - text: 2025-06-28
              - generic [ref=e432]: LATE·411d
            - generic [ref=e433]:
              - generic [ref=e434]: Amount
              - text: $500K–$1M
              - generic [ref=e435]: $500K–$1M
            - generic [ref=e436]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e441] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e442]:
          - button [disabled] [ref=e444]: ☆
          - generic [ref=e445]:
            - generic [ref=e446]: Filed
            - text: 2026-08-13
          - generic [ref=e447]:
            - generic [ref=e448]:
              - generic [ref=e449]: Member
              - link "Sheehy, Timothy P" [ref=e450] [cursor=pointer]:
                - /url: "#feed-footnote"
              - superscript [ref=e451]: †
              - text: —
            - generic [ref=e452]:
              - generic [ref=e453]: Ticker
              - 'generic "WCAS XIV Co-Investors LLC - Constitution Surgery Alliance · asset type as filed: Non-Public Stock" [ref=e454]':
                - text: WCAS XIV Co-Investors LLC - Constitut…
                - generic [ref=e455]: "WCAS XIV Co-Investors LLC - Constitution Surgery Alliance — asset type as filed: Non-Public Stock — asset as filed, no ticker disclosed"
            - generic [ref=e456]:
              - generic [ref=e457]: Side
              - text: Purchase
          - generic [ref=e458]:
            - generic [ref=e459]:
              - generic [ref=e460]: Traded
              - text: 2025-06-16
              - generic [ref=e461]: LATE·423d
            - generic [ref=e462]:
              - generic [ref=e463]: Amount
              - text: $1K–$15K
              - generic [ref=e464]: $1K–$15K
            - generic [ref=e465]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e470] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/e15641c6-d632-4b7a-82d1-45c242b1515a/
              - text: eFD ↗
        - listitem [ref=e471]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e473] [cursor=pointer]: ☆
          - generic [ref=e474]:
            - generic [ref=e475]: Filed
            - text: 2026-08-13
          - generic [ref=e476]:
            - generic [ref=e477]:
              - generic [ref=e478]: Member
              - link "Carol D. Miller" [ref=e479] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e480]:
              - generic [ref=e481]: Ticker
              - link "DGX" [ref=e482] [cursor=pointer]:
                - /url: /tickers/DGX/
            - generic [ref=e483]:
              - generic [ref=e484]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e485]:
                - text: · SP
                - generic [ref=e486]: (spouse-owned)
          - generic [ref=e487]:
            - generic [ref=e488]:
              - generic [ref=e489]: Traded
              - text: 2025-03-10
              - generic [ref=e490]: LATE·521d
            - generic [ref=e491]:
              - generic [ref=e492]: Amount
              - text: $15K–$50K
              - generic [ref=e493]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e498] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e499]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e501] [cursor=pointer]: ☆
          - generic [ref=e502]:
            - generic [ref=e503]: Filed
            - text: 2026-08-13
          - generic [ref=e504]:
            - generic [ref=e505]:
              - generic [ref=e506]: Member
              - link "Carol D. Miller" [ref=e507] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e508]:
              - generic [ref=e509]: Ticker
              - link "TGT" [ref=e510] [cursor=pointer]:
                - /url: /tickers/TGT/
            - generic [ref=e511]:
              - generic [ref=e512]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e513]:
                - text: · SP
                - generic [ref=e514]: (spouse-owned)
          - generic [ref=e515]:
            - generic [ref=e516]:
              - generic [ref=e517]: Traded
              - text: 2025-03-10
              - generic [ref=e518]: LATE·521d
            - generic [ref=e519]:
              - generic [ref=e520]: Amount
              - text: $15K–$50K
              - generic [ref=e521]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e526] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e527]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e529] [cursor=pointer]: ☆
          - generic [ref=e530]:
            - generic [ref=e531]: Filed
            - text: 2026-08-13
          - generic [ref=e532]:
            - generic [ref=e533]:
              - generic [ref=e534]: Member
              - link "Carol D. Miller" [ref=e535] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e536]:
              - generic [ref=e537]: Ticker
              - link "PFE" [ref=e538] [cursor=pointer]:
                - /url: /tickers/PFE/
            - generic [ref=e539]:
              - generic [ref=e540]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e541]:
                - text: · SP
                - generic [ref=e542]: (spouse-owned)
          - generic [ref=e543]:
            - generic [ref=e544]:
              - generic [ref=e545]: Traded
              - text: 2025-03-10
              - generic [ref=e546]: LATE·521d
            - generic [ref=e547]:
              - generic [ref=e548]: Amount
              - text: $15K–$50K
              - generic [ref=e549]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e554] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e555]:
          - button "Watch Carol D. Miller — saved in this browser only" [ref=e557] [cursor=pointer]: ☆
          - generic [ref=e558]:
            - generic [ref=e559]: Filed
            - text: 2026-08-13
          - generic [ref=e560]:
            - generic [ref=e561]:
              - generic [ref=e562]: Member
              - link "Carol D. Miller" [ref=e563] [cursor=pointer]:
                - /url: /congress/members/M001205/
              - text: R–WV-1
            - generic [ref=e564]:
              - generic [ref=e565]: Ticker
              - link "USB" [ref=e566] [cursor=pointer]:
                - /url: /tickers/USB/
            - generic [ref=e567]:
              - generic [ref=e568]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e569]:
                - text: · SP
                - generic [ref=e570]: (spouse-owned)
          - generic [ref=e571]:
            - generic [ref=e572]:
              - generic [ref=e573]: Traded
              - text: 2025-03-10
              - generic [ref=e574]: LATE·521d
            - generic [ref=e575]:
              - generic [ref=e576]: Amount
              - text: $15K–$50K
              - generic [ref=e577]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e582] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033779.pdf
              - text: PTR ↗
        - listitem [ref=e583]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e585] [cursor=pointer]: ☆
          - generic [ref=e586]:
            - generic [ref=e587]: Filed
            - text: 2026-08-13
          - generic [ref=e588]:
            - generic [ref=e589]:
              - generic [ref=e590]: Member
              - link "Rick Scott" [ref=e591] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e592]:
              - generic [ref=e593]: Ticker
              - 'generic "Port of Seattle Washington Revenue Bond · asset type as filed: Municipal Security" [ref=e594]':
                - text: Port of Seattle Washington Revenue Bond
                - generic [ref=e595]: "Port of Seattle Washington Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e596]:
              - generic [ref=e597]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e598]:
                - text: · SP
                - generic [ref=e599]: (spouse-owned)
          - generic [ref=e600]:
            - generic [ref=e601]:
              - generic [ref=e602]: Traded
              - text: 2025-02-07
              - generic [ref=e603]: LATE·552d
            - generic [ref=e604]:
              - generic [ref=e605]: Amount
              - text: $250K–$500K
              - generic [ref=e606]: $250K–$500K
            - generic [ref=e607]:
              - generic [ref=e610]: amendment pending
              - generic [ref=e611]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e613] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e614]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e616] [cursor=pointer]: ☆
          - generic [ref=e617]:
            - generic [ref=e618]: Filed
            - text: 2026-08-13
          - generic [ref=e619]:
            - generic [ref=e620]:
              - generic [ref=e621]: Member
              - link "Rick Scott" [ref=e622] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e623]:
              - generic [ref=e624]: Ticker
              - 'generic "Central Texas Regional Mobility Auth Revenue Bond · asset type as filed: Municipal Security" [ref=e625]':
                - text: Central Texas Regional Mobility Auth …
                - generic [ref=e626]: "Central Texas Regional Mobility Auth Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e627]:
              - generic [ref=e628]: Side
              - text: Sale
          - generic [ref=e629]:
            - generic [ref=e630]:
              - generic [ref=e631]: Traded
              - text: 2025-02-07
              - generic [ref=e632]: LATE·552d
            - generic [ref=e633]:
              - generic [ref=e634]: Amount
              - text: $500K–$1M
              - generic [ref=e635]: $500K–$1M
            - generic [ref=e636]:
              - generic [ref=e639]: amendment pending
              - generic [ref=e640]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e642] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e643]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e645] [cursor=pointer]: ☆
          - generic [ref=e646]:
            - generic [ref=e647]: Filed
            - text: 2026-08-13
          - generic [ref=e648]:
            - generic [ref=e649]:
              - generic [ref=e650]: Member
              - link "Rick Scott" [ref=e651] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e652]:
              - generic [ref=e653]: Ticker
              - 'generic "Port of Seattle Washington Revenue Bond · asset type as filed: Municipal Security" [ref=e654]':
                - text: Port of Seattle Washington Revenue Bond
                - generic [ref=e655]: "Port of Seattle Washington Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e656]:
              - generic [ref=e657]: Side
              - text: Sale
          - generic [ref=e658]:
            - generic [ref=e659]:
              - generic [ref=e660]: Traded
              - text: 2025-02-07
              - generic [ref=e661]: LATE·552d
            - generic [ref=e662]:
              - generic [ref=e663]: Amount
              - text: $100K–$250K
              - generic [ref=e664]: $100K–$250K
            - generic [ref=e665]:
              - generic [ref=e668]: amendment pending
              - generic [ref=e669]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e671] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e672]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e674] [cursor=pointer]: ☆
          - generic [ref=e675]:
            - generic [ref=e676]: Filed
            - text: 2026-08-13
          - generic [ref=e677]:
            - generic [ref=e678]:
              - generic [ref=e679]: Member
              - link "Rick Scott" [ref=e680] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e681]:
              - generic [ref=e682]: Ticker
              - 'generic "Charlotte NC Water & Sewer Sys Revenue Bond · asset type as filed: Municipal Security" [ref=e683]':
                - text: Charlotte NC Water & Sewer Sys Revenu…
                - generic [ref=e684]: "Charlotte NC Water & Sewer Sys Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e685]:
              - generic [ref=e686]: Side
              - text: Purchase
              - generic "spouse-owned" [ref=e687]:
                - text: · SP
                - generic [ref=e688]: (spouse-owned)
          - generic [ref=e689]:
            - generic [ref=e690]:
              - generic [ref=e691]: Traded
              - text: 2025-02-07
              - generic [ref=e692]: LATE·552d
            - generic [ref=e693]:
              - generic [ref=e694]: Amount
              - text: $250K–$500K
              - generic [ref=e695]: $250K–$500K
            - generic [ref=e696]:
              - generic [ref=e699]: amendment pending
              - generic [ref=e700]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e702] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e703]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e705] [cursor=pointer]: ☆
          - generic [ref=e706]:
            - generic [ref=e707]: Filed
            - text: 2026-08-13
          - generic [ref=e708]:
            - generic [ref=e709]:
              - generic [ref=e710]: Member
              - link "Rick Scott" [ref=e711] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e712]:
              - generic [ref=e713]: Ticker
              - 'generic "Charlotte NC Water & Sewer Sys Revenue Bond · asset type as filed: Municipal Security" [ref=e714]':
                - text: Charlotte NC Water & Sewer Sys Revenu…
                - generic [ref=e715]: "Charlotte NC Water & Sewer Sys Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e716]:
              - generic [ref=e717]: Side
              - text: Purchase
          - generic [ref=e718]:
            - generic [ref=e719]:
              - generic [ref=e720]: Traded
              - text: 2025-02-07
              - generic [ref=e721]: LATE·552d
            - generic [ref=e722]:
              - generic [ref=e723]: Amount
              - text: $100K–$250K
              - generic [ref=e724]: $100K–$250K
            - generic [ref=e725]:
              - generic [ref=e728]: amendment pending
              - generic [ref=e729]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e731] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e732]:
          - button "Watch Rick Scott — saved in this browser only" [ref=e734] [cursor=pointer]: ☆
          - generic [ref=e735]:
            - generic [ref=e736]: Filed
            - text: 2026-08-13
          - generic [ref=e737]:
            - generic [ref=e738]:
              - generic [ref=e739]: Member
              - link "Rick Scott" [ref=e740] [cursor=pointer]:
                - /url: /congress/members/S001217/
              - text: R–FL
            - generic [ref=e741]:
              - generic [ref=e742]: Ticker
              - 'generic "Charlotte NC Water & Sewer Sys Revenue Bond · asset type as filed: Municipal Security" [ref=e743]':
                - text: Charlotte NC Water & Sewer Sys Revenu…
                - generic [ref=e744]: "Charlotte NC Water & Sewer Sys Revenue Bond — asset type as filed: Municipal Security — asset as filed, no ticker disclosed"
            - generic [ref=e745]:
              - generic [ref=e746]: Side
              - text: Purchase
          - generic [ref=e747]:
            - generic [ref=e748]:
              - generic [ref=e749]: Traded
              - text: 2025-02-07
              - generic [ref=e750]: LATE·552d
            - generic [ref=e751]:
              - generic [ref=e752]: Amount
              - text: $500K–$1M
              - generic [ref=e753]: $500K–$1M
            - generic [ref=e754]:
              - generic [ref=e757]: amendment pending
              - generic [ref=e758]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e760] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/f0a05c3b-66e0-4287-a388-454e2b4c823d/
              - text: eFD ↗
        - listitem [ref=e761]:
          - button "Watch Tracey Mann — saved in this browser only" [ref=e763] [cursor=pointer]: ☆
          - generic [ref=e764]:
            - generic [ref=e765]: Filed
            - text: 2026-08-13
          - generic [ref=e766]:
            - link "Tracey Mann" [ref=e767] [cursor=pointer]:
              - /url: /congress/members/M000871/
            - generic [ref=e768]: R–KS-1
            - generic [ref=e769]: paper filing — needs OCR
            - generic [ref=e770]: transactions filed on paper; retained and counted, not yet machine-readable
          - link "source document (PTR) — opens in a new tab" [ref=e772] [cursor=pointer]:
            - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/9116292.pdf
            - text: PTR ↗
        - listitem [ref=e773]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e775] [cursor=pointer]: ☆
          - generic [ref=e776]:
            - generic [ref=e777]: Filed
            - text: 2026-08-12
          - generic [ref=e778]:
            - generic [ref=e779]:
              - generic [ref=e780]: Member
              - link "Kevin Hern" [ref=e781] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e782]:
              - generic [ref=e783]: Ticker
              - link "VSNT" [ref=e784] [cursor=pointer]:
                - /url: /tickers/VSNT/
            - generic [ref=e785]:
              - generic [ref=e786]: Side
              - text: Sale
              - generic "jointly owned" [ref=e787]:
                - text: · JT
                - generic [ref=e788]: (jointly owned)
          - generic [ref=e789]:
            - generic [ref=e790]:
              - generic [ref=e791]: Traded
              - text: 08-05 +7d
            - generic [ref=e792]:
              - generic [ref=e793]: Amount
              - text: $1K–$15K
              - generic [ref=e794]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e799] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035196.pdf
              - text: PTR ↗
        - listitem [ref=e800]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e802] [cursor=pointer]: ☆
          - generic [ref=e803]:
            - generic [ref=e804]: Filed
            - text: 2026-08-12
          - generic [ref=e805]:
            - generic [ref=e806]:
              - generic [ref=e807]: Member
              - link "Kevin Hern" [ref=e808] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e809]:
              - generic [ref=e810]: Ticker
              - link "OGN" [ref=e811] [cursor=pointer]:
                - /url: /tickers/OGN/
            - generic [ref=e812]:
              - generic [ref=e813]: Side
              - text: Sale
              - generic "jointly owned" [ref=e814]:
                - text: · JT
                - generic [ref=e815]: (jointly owned)
          - generic [ref=e816]:
            - generic [ref=e817]:
              - generic [ref=e818]: Traded
              - text: 08-05 +7d
            - generic [ref=e819]:
              - generic [ref=e820]: Amount
              - text: $1K–$15K
              - generic [ref=e821]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e826] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035196.pdf
              - text: PTR ↗
        - listitem [ref=e827]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e829] [cursor=pointer]: ☆
          - generic [ref=e830]:
            - generic [ref=e831]: Filed
            - text: 2026-08-12
          - generic [ref=e832]:
            - generic [ref=e833]:
              - generic [ref=e834]: Member
              - link "Mike Kelly" [ref=e835] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e836]:
              - generic [ref=e837]: Ticker
              - link "ABT" [ref=e838] [cursor=pointer]:
                - /url: /tickers/ABT/
            - generic [ref=e839]:
              - generic [ref=e840]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e841]:
                - text: · SP
                - generic [ref=e842]: (spouse-owned)
          - generic [ref=e843]:
            - generic [ref=e844]:
              - generic [ref=e845]: Traded
              - text: 07-17 +26d
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
              - text: 07-17 +26d
            - generic [ref=e873]:
              - generic [ref=e874]: Amount
              - text: $1K–$15K
              - generic [ref=e875]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e880] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e881]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e883] [cursor=pointer]: ☆
          - generic [ref=e884]:
            - generic [ref=e885]: Filed
            - text: 2026-08-12
          - generic [ref=e886]:
            - generic [ref=e887]:
              - generic [ref=e888]: Member
              - link "Mike Kelly" [ref=e889] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e890]:
              - generic [ref=e891]: Ticker
              - link "PEP" [ref=e892] [cursor=pointer]:
                - /url: /tickers/PEP/
            - generic [ref=e893]:
              - generic [ref=e894]: Side
              - text: Sale
              - generic "spouse-owned" [ref=e895]:
                - text: · SP
                - generic [ref=e896]: (spouse-owned)
          - generic [ref=e897]:
            - generic [ref=e898]:
              - generic [ref=e899]: Traded
              - text: 07-17 +26d
            - generic [ref=e900]:
              - generic [ref=e901]: Amount
              - text: $15K–$50K
              - generic [ref=e902]: $15K–$50K
            - link "source document (PTR) — opens in a new tab" [ref=e907] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e908]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e910] [cursor=pointer]: ☆
          - generic [ref=e911]:
            - generic [ref=e912]: Filed
            - text: 2026-08-12
          - generic [ref=e913]:
            - generic [ref=e914]:
              - generic [ref=e915]: Member
              - link "Mike Kelly" [ref=e916] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e917]:
              - generic [ref=e918]: Ticker
              - 'generic "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] · asset type as filed: GS" [ref=e919]':
                - text: California Cmnty Choice Fing & Clean …
                - generic [ref=e920]: "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e921]:
              - generic [ref=e922]: Side
              - text: Purchase
              - generic "spouse-owned" [ref=e923]:
                - text: · SP
                - generic [ref=e924]: (spouse-owned)
          - generic [ref=e925]:
            - generic [ref=e926]:
              - generic [ref=e927]: Traded
              - text: 07-17 +26d
            - generic [ref=e928]:
              - generic [ref=e929]: Amount
              - text: $50K–$100K
              - generic [ref=e930]: $50K–$100K
            - generic [ref=e931]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e936] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035209.pdf
              - text: PTR ↗
        - listitem [ref=e937]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e939] [cursor=pointer]: ☆
          - generic [ref=e940]:
            - generic [ref=e941]: Filed
            - text: 2026-08-12
          - generic [ref=e942]:
            - generic [ref=e943]:
              - generic [ref=e944]: Member
              - link "Mike Kelly" [ref=e945] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e946]:
              - generic [ref=e947]: Ticker
              - 'generic "Florida St Hsg Fin Corp Rev 3% due 7/1/52 [GS] · asset type as filed: GS" [ref=e948]':
                - text: Florida St Hsg Fin Corp Rev 3% due 7/…
                - generic [ref=e949]: "Florida St Hsg Fin Corp Rev 3% due 7/1/52 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e950]:
              - generic [ref=e951]: Side
              - text: Sale
              - generic "partial sale, spouse-owned" [ref=e952]:
                - text: · partial · SP
                - generic [ref=e953]: (partial sale, spouse-owned)
          - generic [ref=e954]:
            - generic [ref=e955]:
              - generic [ref=e956]: Traded
              - text: 07-01 +42d
            - generic [ref=e957]:
              - generic [ref=e958]: Amount
              - text: $1K–$15K
              - generic [ref=e959]: $1K–$15K
            - generic [ref=e960]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e965] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e966]:
          - button "Watch Robert P. Bresnahan, Jr. — saved in this browser only" [ref=e968] [cursor=pointer]: ☆
          - generic [ref=e969]:
            - generic [ref=e970]: Filed
            - text: 2026-08-12
          - generic [ref=e971]:
            - generic [ref=e972]:
              - generic [ref=e973]: Member
              - link "Robert P. Bresnahan, Jr." [ref=e974] [cursor=pointer]:
                - /url: /congress/members/B001327/
              - text: R–PA-8
            - generic [ref=e975]:
              - generic [ref=e976]: Ticker
              - 'generic "US Treasury Note 06/30/27 [GS] · asset type as filed: GS" [ref=e977]':
                - text: US Treasury Note 06/30/27 [GS]
                - generic [ref=e978]: "US Treasury Note 06/30/27 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e979]:
              - generic [ref=e980]: Side
              - text: Purchase
          - generic [ref=e981]:
            - generic [ref=e982]:
              - generic [ref=e983]: Traded
              - text: 07-01 +42d
            - generic [ref=e984]:
              - generic [ref=e985]: Amount
              - text: $15K–$50K
              - generic [ref=e986]: $15K–$50K
            - generic [ref=e987]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e992] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035216.pdf
              - text: PTR ↗
        - listitem [ref=e993]:
          - button "Watch Mike Kelly — saved in this browser only" [ref=e995] [cursor=pointer]: ☆
          - generic [ref=e996]:
            - generic [ref=e997]: Filed
            - text: 2026-08-12
          - generic [ref=e998]:
            - generic [ref=e999]:
              - generic [ref=e1000]: Member
              - link "Mike Kelly" [ref=e1001] [cursor=pointer]:
                - /url: /congress/members/K000376/
              - text: R–PA-16
            - generic [ref=e1002]:
              - generic [ref=e1003]: Ticker
              - 'generic "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] · asset type as filed: GS" [ref=e1004]':
                - text: California Cmnty Choice Fing & Clean …
                - generic [ref=e1005]: "California Cmnty Choice Fing & Clean Ener 5% due 10/1/2034% [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1006]:
              - generic [ref=e1007]: Side
              - text: Purchase
              - generic "spouse-owned" [ref=e1008]:
                - text: · SP
                - generic [ref=e1009]: (spouse-owned)
          - generic [ref=e1010]:
            - generic [ref=e1011]:
              - generic [ref=e1012]: Traded
              - text: 2025-07-17
              - generic [ref=e1013]: LATE·391d
            - generic [ref=e1014]:
              - generic [ref=e1015]: Amount
              - text: $50K–$100K
              - generic [ref=e1016]: $50K–$100K
            - generic [ref=e1017]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1022] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035203.pdf
              - text: PTR ↗
        - listitem [ref=e1023]:
          - button "Watch Charles J. \"Chuck\" Fleischmann — saved in this browser only" [ref=e1025] [cursor=pointer]: ☆
          - generic [ref=e1026]:
            - generic [ref=e1027]: Filed
            - text: 2026-08-12
          - generic [ref=e1028]:
            - link "Charles J. \"Chuck\" Fleischmann" [ref=e1029] [cursor=pointer]:
              - /url: /congress/members/F000459/
            - generic [ref=e1030]: R–TN-3
            - generic [ref=e1031]: paper filing — needs OCR
            - generic [ref=e1032]: transactions filed on paper; retained and counted, not yet machine-readable
          - link "source document (PTR) — opens in a new tab" [ref=e1034] [cursor=pointer]:
            - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/9116290.pdf
            - text: PTR ↗
        - listitem [ref=e1035]:
          - button "Watch Suzan K. DelBene — saved in this browser only" [ref=e1037] [cursor=pointer]: ☆
          - generic [ref=e1038]:
            - generic [ref=e1039]: Filed
            - text: 2026-08-11
          - generic [ref=e1040]:
            - generic [ref=e1041]:
              - generic [ref=e1042]: Member
              - link "Suzan K. DelBene" [ref=e1043] [cursor=pointer]:
                - /url: /congress/members/D000617/
              - text: D–WA-1
            - generic [ref=e1044]:
              - generic [ref=e1045]: Ticker
              - 'generic "Fort Bend Tex Indpt SCH Dist Variable 04.00000% 08/01/2054 Rate Unltd Tax BLDG Ref BDS Ser. 2024B [GS] · asset type as filed: GS" [ref=e1046]':
                - text: Fort Bend Tex Indpt SCH Dist Variable…
                - generic [ref=e1047]: "Fort Bend Tex Indpt SCH Dist Variable 04.00000% 08/01/2054 Rate Unltd Tax BLDG Ref BDS Ser. 2024B [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1048]:
              - generic [ref=e1049]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1050]:
                - text: · JT
                - generic [ref=e1051]: (jointly owned)
          - generic [ref=e1052]:
            - generic [ref=e1053]:
              - generic [ref=e1054]: Traded
              - text: 07-23 +19d
            - generic [ref=e1055]:
              - generic [ref=e1056]: Amount
              - text: $250K–$500K
              - generic [ref=e1057]: $250K–$500K
            - generic [ref=e1058]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1063] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035175.pdf
              - text: PTR ↗
        - listitem [ref=e1064]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1066] [cursor=pointer]: ☆
          - generic [ref=e1067]:
            - generic [ref=e1068]: Filed
            - text: 2026-08-10
          - generic [ref=e1069]:
            - generic [ref=e1070]:
              - generic [ref=e1071]: Member
              - link "Kevin Hern" [ref=e1072] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1073]:
              - generic [ref=e1074]: Ticker
              - link "KVUE" [ref=e1075] [cursor=pointer]:
                - /url: /tickers/KVUE/
            - generic [ref=e1076]:
              - generic [ref=e1077]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1078]:
                - text: · JT
                - generic [ref=e1079]: (jointly owned)
          - generic [ref=e1080]:
            - generic [ref=e1081]:
              - generic [ref=e1082]: Traded
              - text: 08-05 +5d
            - generic [ref=e1083]:
              - generic [ref=e1084]: Amount
              - text: $1K–$15K
              - generic [ref=e1085]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1090] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1091]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1093] [cursor=pointer]: ☆
          - generic [ref=e1094]:
            - generic [ref=e1095]: Filed
            - text: 2026-08-10
          - generic [ref=e1096]:
            - generic [ref=e1097]:
              - generic [ref=e1098]: Member
              - link "Kevin Hern" [ref=e1099] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1100]:
              - generic [ref=e1101]: Ticker
              - link "EL" [ref=e1102] [cursor=pointer]:
                - /url: /tickers/EL/
            - generic [ref=e1103]:
              - generic [ref=e1104]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1105]:
                - text: · JT
                - generic [ref=e1106]: (jointly owned)
          - generic [ref=e1107]:
            - generic [ref=e1108]:
              - generic [ref=e1109]: Traded
              - text: 08-05 +5d
            - generic [ref=e1110]:
              - generic [ref=e1111]: Amount
              - text: $1K–$15K
              - generic [ref=e1112]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1117] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1118]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1120] [cursor=pointer]: ☆
          - generic [ref=e1121]:
            - generic [ref=e1122]: Filed
            - text: 2026-08-10
          - generic [ref=e1123]:
            - generic [ref=e1124]:
              - generic [ref=e1125]: Member
              - link "Kevin Hern" [ref=e1126] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1127]:
              - generic [ref=e1128]: Ticker
              - link "VSNT" [ref=e1129] [cursor=pointer]:
                - /url: /tickers/VSNT/
            - generic [ref=e1130]:
              - generic [ref=e1131]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1132]:
                - text: · JT
                - generic [ref=e1133]: (jointly owned)
          - generic [ref=e1134]:
            - generic [ref=e1135]:
              - generic [ref=e1136]: Traded
              - text: 08-05 +5d
            - generic [ref=e1137]:
              - generic [ref=e1138]: Amount
              - text: $1K–$15K
              - generic [ref=e1139]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1144] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1145]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1147] [cursor=pointer]: ☆
          - generic [ref=e1148]:
            - generic [ref=e1149]: Filed
            - text: 2026-08-10
          - generic [ref=e1150]:
            - generic [ref=e1151]:
              - generic [ref=e1152]: Member
              - link "Kevin Hern" [ref=e1153] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1154]:
              - generic [ref=e1155]: Ticker
              - link "MDLZ" [ref=e1156] [cursor=pointer]:
                - /url: /tickers/MDLZ/
            - generic [ref=e1157]:
              - generic [ref=e1158]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1159]:
                - text: · JT
                - generic [ref=e1160]: (jointly owned)
          - generic [ref=e1161]:
            - generic [ref=e1162]:
              - generic [ref=e1163]: Traded
              - text: 08-05 +5d
            - generic [ref=e1164]:
              - generic [ref=e1165]: Amount
              - text: $1K–$15K
              - generic [ref=e1166]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1171] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1172]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1174] [cursor=pointer]: ☆
          - generic [ref=e1175]:
            - generic [ref=e1176]: Filed
            - text: 2026-08-10
          - generic [ref=e1177]:
            - generic [ref=e1178]:
              - generic [ref=e1179]: Member
              - link "Kevin Hern" [ref=e1180] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1181]:
              - generic [ref=e1182]: Ticker
              - link "CMCSA" [ref=e1183] [cursor=pointer]:
                - /url: /tickers/CMCSA/
            - generic [ref=e1184]:
              - generic [ref=e1185]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1186]:
                - text: · JT
                - generic [ref=e1187]: (jointly owned)
          - generic [ref=e1188]:
            - generic [ref=e1189]:
              - generic [ref=e1190]: Traded
              - text: 08-05 +5d
            - generic [ref=e1191]:
              - generic [ref=e1192]: Amount
              - text: $1K–$15K
              - generic [ref=e1193]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1198] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1199]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1201] [cursor=pointer]: ☆
          - generic [ref=e1202]:
            - generic [ref=e1203]: Filed
            - text: 2026-08-10
          - generic [ref=e1204]:
            - generic [ref=e1205]:
              - generic [ref=e1206]: Member
              - link "Kevin Hern" [ref=e1207] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1208]:
              - generic [ref=e1209]: Ticker
              - link "OGN" [ref=e1210] [cursor=pointer]:
                - /url: /tickers/OGN/
            - generic [ref=e1211]:
              - generic [ref=e1212]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1213]:
                - text: · JT
                - generic [ref=e1214]: (jointly owned)
          - generic [ref=e1215]:
            - generic [ref=e1216]:
              - generic [ref=e1217]: Traded
              - text: 08-05 +5d
            - generic [ref=e1218]:
              - generic [ref=e1219]: Amount
              - text: $1K–$15K
              - generic [ref=e1220]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1225] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1226]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1228] [cursor=pointer]: ☆
          - generic [ref=e1229]:
            - generic [ref=e1230]: Filed
            - text: 2026-08-10
          - generic [ref=e1231]:
            - generic [ref=e1232]:
              - generic [ref=e1233]: Member
              - link "Kevin Hern" [ref=e1234] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1235]:
              - generic [ref=e1236]: Ticker
              - link "DEO" [ref=e1237] [cursor=pointer]:
                - /url: /tickers/DEO/
            - generic [ref=e1238]:
              - generic [ref=e1239]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1240]:
                - text: · JT
                - generic [ref=e1241]: (jointly owned)
          - generic [ref=e1242]:
            - generic [ref=e1243]:
              - generic [ref=e1244]: Traded
              - text: 08-05 +5d
            - generic [ref=e1245]:
              - generic [ref=e1246]: Amount
              - text: $1K–$15K
              - generic [ref=e1247]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1252] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1253]:
          - button "Watch John J. McGuire III — saved in this browser only" [ref=e1255] [cursor=pointer]: ☆
          - generic [ref=e1256]:
            - generic [ref=e1257]: Filed
            - text: 2026-08-10
          - generic [ref=e1258]:
            - generic [ref=e1259]:
              - generic [ref=e1260]: Member
              - link "John J. McGuire III" [ref=e1261] [cursor=pointer]:
                - /url: /congress/members/M001239/
              - text: R–VA-5
            - generic [ref=e1262]:
              - generic [ref=e1263]: Ticker
              - link "PANW" [ref=e1264] [cursor=pointer]:
                - /url: /tickers/PANW/
            - generic [ref=e1265]:
              - generic [ref=e1266]: Side
              - text: Sale
              - generic "partial sale, spouse-owned" [ref=e1267]:
                - text: · partial · SP
                - generic [ref=e1268]: (partial sale, spouse-owned)
          - generic [ref=e1269]:
            - generic [ref=e1270]:
              - generic [ref=e1271]: Traded
              - text: 07-31 +10d
            - generic [ref=e1272]:
              - generic [ref=e1273]: Amount
              - text: $1K–$15K
              - generic [ref=e1274]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1279] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035180.pdf
              - text: PTR ↗
        - listitem [ref=e1280]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1282] [cursor=pointer]: ☆
          - generic [ref=e1283]:
            - generic [ref=e1284]: Filed
            - text: 2026-08-10
          - generic [ref=e1285]:
            - generic [ref=e1286]:
              - generic [ref=e1287]: Member
              - link "Kevin Hern" [ref=e1288] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1289]:
              - generic [ref=e1290]: Ticker
              - 'generic "TULSA CNTY OKLA INDPT SCH DIST NO 02.00000% 09/01/2026 [GS] · asset type as filed: GS" [ref=e1291]':
                - text: TULSA CNTY OKLA INDPT SCH DIST NO 02.…
                - generic [ref=e1292]: "TULSA CNTY OKLA INDPT SCH DIST NO 02.00000% 09/01/2026 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1293]:
              - generic [ref=e1294]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1295]:
                - text: · JT
                - generic [ref=e1296]: (jointly owned)
          - generic [ref=e1297]:
            - generic [ref=e1298]:
              - generic [ref=e1299]: Traded
              - text: 07-24 +17d
            - generic [ref=e1300]:
              - generic [ref=e1301]: Amount
              - text: $100K–$250K
              - generic [ref=e1302]: $100K–$250K
            - generic [ref=e1303]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1308] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1309]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1311] [cursor=pointer]: ☆
          - generic [ref=e1312]:
            - generic [ref=e1313]: Filed
            - text: 2026-08-10
          - generic [ref=e1314]:
            - generic [ref=e1315]:
              - generic [ref=e1316]: Member
              - link "Kevin Hern" [ref=e1317] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1318]:
              - generic [ref=e1319]: Ticker
              - 'generic "CADDO CNTY OKLA GOVERNMENTAL BLDG 05.00000% 09/01/2030 [GS] · asset type as filed: GS" [ref=e1320]':
                - text: CADDO CNTY OKLA GOVERNMENTAL BLDG 05.…
                - generic [ref=e1321]: "CADDO CNTY OKLA GOVERNMENTAL BLDG 05.00000% 09/01/2030 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1322]:
              - generic [ref=e1323]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1324]:
                - text: · JT
                - generic [ref=e1325]: (jointly owned)
          - generic [ref=e1326]:
            - generic [ref=e1327]:
              - generic [ref=e1328]: Traded
              - text: 07-24 +17d
            - generic [ref=e1329]:
              - generic [ref=e1330]: Amount
              - text: $50K–$100K
              - generic [ref=e1331]: $50K–$100K
            - generic [ref=e1332]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1337] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
        - listitem [ref=e1338]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1340] [cursor=pointer]: ☆
          - generic [ref=e1341]:
            - generic [ref=e1342]: Filed
            - text: 2026-08-10
          - generic [ref=e1343]:
            - generic [ref=e1344]:
              - generic [ref=e1345]: Member
              - link "Josh Gottheimer" [ref=e1346] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1347]:
              - generic [ref=e1348]: Ticker
              - link "GOOGM" [ref=e1349] [cursor=pointer]:
                - /url: /tickers/GOOGM/
            - generic [ref=e1350]:
              - generic [ref=e1351]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1352]:
                - text: · JT
                - generic [ref=e1353]: (jointly owned)
          - generic [ref=e1354]:
            - generic [ref=e1355]:
              - generic [ref=e1356]: Traded
              - text: 07-24 +17d
            - generic [ref=e1357]:
              - generic [ref=e1358]: Amount
              - text: $1K–$15K
              - generic [ref=e1359]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1364] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1365]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1367] [cursor=pointer]: ☆
          - generic [ref=e1368]:
            - generic [ref=e1369]: Filed
            - text: 2026-08-10
          - generic [ref=e1370]:
            - generic [ref=e1371]:
              - generic [ref=e1372]: Member
              - link "Josh Gottheimer" [ref=e1373] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1374]:
              - generic [ref=e1375]: Ticker
              - link "GOOGN" [ref=e1376] [cursor=pointer]:
                - /url: /tickers/GOOGN/
            - generic [ref=e1377]:
              - generic [ref=e1378]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1379]:
                - text: · JT
                - generic [ref=e1380]: (jointly owned)
          - generic [ref=e1381]:
            - generic [ref=e1382]:
              - generic [ref=e1383]: Traded
              - text: 07-24 +17d
            - generic [ref=e1384]:
              - generic [ref=e1385]: Amount
              - text: $1K–$15K
              - generic [ref=e1386]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1391] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1392]:
          - button "Watch John Fetterman — saved in this browser only" [ref=e1394] [cursor=pointer]: ☆
          - generic [ref=e1395]:
            - generic [ref=e1396]: Filed
            - text: 2026-08-10
          - generic [ref=e1397]:
            - generic [ref=e1398]:
              - generic [ref=e1399]: Member
              - link "John Fetterman" [ref=e1400] [cursor=pointer]:
                - /url: /congress/members/F000479/
              - text: D–PA
            - generic [ref=e1401]:
              - generic [ref=e1402]: Ticker
              - 'generic "Freeport McMoran · asset type as filed: Corporate Bond" [ref=e1403]':
                - text: Freeport McMoran
                - generic [ref=e1404]: "Freeport McMoran — asset type as filed: Corporate Bond — asset as filed, no ticker disclosed"
            - generic [ref=e1405]:
              - generic [ref=e1406]: Side
              - text: Sale
              - generic "dependent-child-owned" [ref=e1407]:
                - text: · DC
                - generic [ref=e1408]: (dependent-child-owned)
          - generic [ref=e1409]:
            - generic [ref=e1410]:
              - generic [ref=e1411]: Traded
              - text: 07-24 +17d
            - generic [ref=e1412]:
              - generic [ref=e1413]: Amount
              - text: $1K–$15K
              - generic [ref=e1414]: $1K–$15K
            - generic [ref=e1415]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e1420] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/c993b04b-6773-47e2-9b61-ab5dfe9e68b1/
              - text: eFD ↗
        - listitem [ref=e1421]:
          - button "Watch John Fetterman — saved in this browser only" [ref=e1423] [cursor=pointer]: ☆
          - generic [ref=e1424]:
            - generic [ref=e1425]: Filed
            - text: 2026-08-10
          - generic [ref=e1426]:
            - generic [ref=e1427]:
              - generic [ref=e1428]: Member
              - link "John Fetterman" [ref=e1429] [cursor=pointer]:
                - /url: /congress/members/F000479/
              - text: D–PA
            - generic [ref=e1430]:
              - generic [ref=e1431]: Ticker
              - 'generic "Hasbro Inc Note · asset type as filed: Corporate Bond" [ref=e1432]':
                - text: Hasbro Inc Note
                - generic [ref=e1433]: "Hasbro Inc Note — asset type as filed: Corporate Bond — asset as filed, no ticker disclosed"
            - generic [ref=e1434]:
              - generic [ref=e1435]: Side
              - text: Sale
              - generic "dependent-child-owned" [ref=e1436]:
                - text: · DC
                - generic [ref=e1437]: (dependent-child-owned)
          - generic [ref=e1438]:
            - generic [ref=e1439]:
              - generic [ref=e1440]: Traded
              - text: 07-24 +17d
            - generic [ref=e1441]:
              - generic [ref=e1442]: Amount
              - text: $1K–$15K
              - generic [ref=e1443]: $1K–$15K
            - generic [ref=e1444]: no ticker
            - link "source document (eFD) — opens in a new tab" [ref=e1449] [cursor=pointer]:
              - /url: https://efdsearch.senate.gov/search/view/ptr/c993b04b-6773-47e2-9b61-ab5dfe9e68b1/
              - text: eFD ↗
        - listitem [ref=e1450]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1452] [cursor=pointer]: ☆
          - generic [ref=e1453]:
            - generic [ref=e1454]: Filed
            - text: 2026-08-10
          - generic [ref=e1455]:
            - generic [ref=e1456]:
              - generic [ref=e1457]: Member
              - link "Josh Gottheimer" [ref=e1458] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1459]:
              - generic [ref=e1460]: Ticker
              - link "CCI" [ref=e1461] [cursor=pointer]:
                - /url: /tickers/CCI/
            - generic [ref=e1462]:
              - generic [ref=e1463]: Side
              - text: Sale
              - generic "jointly owned" [ref=e1464]:
                - text: · JT
                - generic [ref=e1465]: (jointly owned)
          - generic [ref=e1466]:
            - generic [ref=e1467]:
              - generic [ref=e1468]: Traded
              - text: 07-23 +18d
            - generic [ref=e1469]:
              - generic [ref=e1470]: Amount
              - text: $1K–$15K
              - generic [ref=e1471]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1476] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1477]:
          - button "Watch Josh Gottheimer — saved in this browser only" [ref=e1479] [cursor=pointer]: ☆
          - generic [ref=e1480]:
            - generic [ref=e1481]: Filed
            - text: 2026-08-10
          - generic [ref=e1482]:
            - generic [ref=e1483]:
              - generic [ref=e1484]: Member
              - link "Josh Gottheimer" [ref=e1485] [cursor=pointer]:
                - /url: /congress/members/G000583/
              - text: D–NJ-5
            - generic [ref=e1486]:
              - generic [ref=e1487]: Ticker
              - link "GOOGN" [ref=e1488] [cursor=pointer]:
                - /url: /tickers/GOOGN/
            - generic [ref=e1489]:
              - generic [ref=e1490]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1491]:
                - text: · JT
                - generic [ref=e1492]: (jointly owned)
          - generic [ref=e1493]:
            - generic [ref=e1494]:
              - generic [ref=e1495]: Traded
              - text: 07-23 +18d
            - generic [ref=e1496]:
              - generic [ref=e1497]: Amount
              - text: $1K–$15K
              - generic [ref=e1498]: $1K–$15K
            - link "source document (PTR) — opens in a new tab" [ref=e1503] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035186.pdf
              - text: PTR ↗
        - listitem [ref=e1504]:
          - button "Watch Kevin Hern — saved in this browser only" [ref=e1506] [cursor=pointer]: ☆
          - generic [ref=e1507]:
            - generic [ref=e1508]: Filed
            - text: 2026-08-10
          - generic [ref=e1509]:
            - generic [ref=e1510]:
              - generic [ref=e1511]: Member
              - link "Kevin Hern" [ref=e1512] [cursor=pointer]:
                - /url: /congress/members/H001082/
              - text: R–OK-1
            - generic [ref=e1513]:
              - generic [ref=e1514]: Ticker
              - 'generic "KINGFISHER CNTY OKLA EDL FACS AUTH EDL 03.00000% 03/01/2031 [GS] · asset type as filed: GS" [ref=e1515]':
                - text: KINGFISHER CNTY OKLA EDL FACS AUTH ED…
                - generic [ref=e1516]: "KINGFISHER CNTY OKLA EDL FACS AUTH EDL 03.00000% 03/01/2031 [GS] — asset type as filed: GS — asset as filed, no ticker disclosed"
            - generic [ref=e1517]:
              - generic [ref=e1518]: Side
              - text: Purchase
              - generic "jointly owned" [ref=e1519]:
                - text: · JT
                - generic [ref=e1520]: (jointly owned)
          - generic [ref=e1521]:
            - generic [ref=e1522]:
              - generic [ref=e1523]: Traded
              - text: 07-20 +21d
            - generic [ref=e1524]:
              - generic [ref=e1525]: Amount
              - text: $100K–$250K
              - generic [ref=e1526]: $100K–$250K
            - generic [ref=e1527]: no ticker
            - link "source document (PTR) — opens in a new tab" [ref=e1532] [cursor=pointer]:
              - /url: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035134.pdf
              - text: PTR ↗
      - generic [ref=e1533]:
        - text: † filer not yet joined to a member record — name as printed on the filing
        - code [ref=e1534]: bioguide_id=null
        - text: ‡ Senate spouse amounts above $1M print only as "Over $1,000,000"
        - code [ref=e1535]: amount_spouse_cap
      - generic [ref=e1536]:
        - generic [ref=e1537]:
          - text: v_default_transactions — active filings minus superseded amendment originals ·
          - link "what's excluded ↗" [ref=e1538] [cursor=pointer]:
            - /url: /methodology/#defaults
        - generic [ref=e1539]:
          - generic [ref=e1540]: 1–50 of 71,714 transactions · 3,047 paper filings (2 here)
          - button "← newer" [disabled] [ref=e1541]
          - button "older →" [ref=e1542] [cursor=pointer]
      - status [ref=e1543]
  - contentinfo [ref=e1544]:
    - generic [ref=e1545]:
      - generic [ref=e1546]:
        - strong [ref=e1547]: Prohibited uses.
        - text: Use of congressional financial-disclosure reports for commercial purposes, for determining credit, or for solicitation is restricted by 5 U.S.C. § 13107(c). Public Filings republishes these public records for transparency and research. Nothing here is financial advice.
      - generic [ref=e1548]:
        - strong [ref=e1549]: Sources.
        - text: "House Clerk PTR · Senate eFD · SEC EDGAR · congress-legislators (CC0) · kadoa seed (MIT). Per-source conditions:"
        - link "DATA-LICENSE ↗" [ref=e1550] [cursor=pointer]:
          - /url: /legal/DATA-LICENSE.md
        - text: ·
        - link "NOTICE ↗" [ref=e1551] [cursor=pointer]:
          - /url: /legal/NOTICE.txt
      - generic [ref=e1552]: build 20260817.1 · code 609cfa272e803956cbe66d8f531343e084b72162no cookies · no account required · no tracking
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
      |         ^ Error: the page scrolls sideways by 200px at 964px — widest offender: div.tiles reaching x=1164 against a 964px viewport
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