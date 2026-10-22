/* launch M1a (T1.1): the honesty-selector list, extracted from css-fold.test.ts
   UNCHANGED (104 entries) so the node CSS sweeps and the Playwright phone
   predicates read one list. Any ≤720px rule matching one of these must never
   remove the element from the accessibility tree, clamp it, or ellipsise it
   (launch-phone-css.test.ts), and on a phone each must stay visible, unclipped
   and inside the viewport (geometry/phone.spec.ts). A class joins here in the
   milestone that ships it. */

/** The honesty-selector allowlist: any ≤720px rule matching one of these must
    never remove the element from the accessibility tree. */
export const HONESTY_SELECTORS: readonly string[] = [
  ".cell-filed",
  ".cell-traded",
  ".traded-date",
  ".mobile-dates",
  ".lag",
  ".lag-late",
  ".lag-anomaly",
  ".owner-note",
  ".flag",
  ".cell-src",
  ".src-missing",
  ".src-derived",
  ".feed-footnote",
  ".footnotes-stacked",
  ".footnote-line",
  ".dagger",
  ".fn-ref",
  ".terminus",
  ".caveat-line",
  ".caveat-inline",
  /* SL-R15/LD8 point 4: the collapsed §5 box's summary is now the honesty
     channel that stands in for the always-open body, so the fold sweep must
     protect it exactly as it protects `.caveat-line`. */
  ".caveat-box-summary",
  ".table-stamp",
  ".inst-stamp",
  ".rb-caption",
  /* SIGNALS-CLARITY M3 (R19): the Monthly flow panel's honesty lines — the
     exclusion counts, the per-month "≈p% filed (est.)" shading labels, the
     completeness method with its measured CDF and stated bias — and the
     visually-hidden month table that carries every figure for assistive
     technology. (Its method caption is `.rb-caption`, above.) */
  ".mf-exclusions",
  ".mf-shade-labels",
  ".mf-completeness",
  ".mf-table",
  /* launch M3b (R21, LD23), joined at integration: the Members chart's
     "Filling in (est.)" zone label, the plot's polite readout (each month's
     figures, "≈p% filed (est.)" included) and the chart's notes. */
  ".mf-fill",
  ".mf-readout",
  ".mf-notes",
  ".c-traded",
  ".c-src",
  ".c-flags",
  ".c-amount",
  ".spec-dates",
  /* signals-v3 M3: `.si-asof` left with the ticker's section index (its "as
     of" stays in the provenance strip, `.stamp-line`). The ticker page's own
     honesty lines join below with the M3 sweep. */
  ".filter-count",
  ".paper-note",
  ".chip-ocr",
  ".nc-chip",
  ".qoq-chip",
  ".s7-banner",
  ".period-note",
  ".mtile-sub",
  ".view-note",
  /* RUN ALPHA-SURFACES-V2. Each of these carries a fact about what the reader
     is NOT seeing, so none may be suppressed at any swept width:
     `.col-why`  — why a column cannot be sorted
     `.compact-disclosure` — the count a collapsed table is holding back
     `.unranked-sep` — the count of rows a column cannot rank, and why */
  ".col-why",
  ".compact-disclosure",
  ".unranked-sep",
  /* Institutional (R9/R11/R22): each states a fact about what is NOT shown or
     what a number does not mean, so none may be suppressed at any width:
     `.mgr-person`  — the person behind a curated display name
     `.mgr-chip`    — the manager's curated type, and the notable flag
     `.c-issuer`    — the issuer a change is attributed to
     `.c-secondary` — the manager, still full-contrast, merely not the anchor */
  ".mgr-person",
  ".mgr-chip",
  ".c-issuer",
  ".c-secondary",
  /* SIGNALS-CLARITY M2 (R10, R12): the count of hits the default "Listed
     stocks only" view hides, and the asset-type chip that labels the filed
     type of every hit that is NOT a listed stock (a listed stock carries
     none) — neither may vanish at a breakpoint. */
  ".si-hidden-count",
  ".si-asset-chip",
  /* signals-v3 M2 (R11, R12, R23): a triage row's both dates, its LATE tag,
     owner and receipt; a lead card's dual dates and receipt; the committee
     caveat on the committee card and in the Cmte legend; and the meter's
     inline name on phones. None may vanish at a breakpoint. */
  ".si-row-filed",
  ".si-row-traded",
  ".si-row-src",
  ".si-late-tag",
  ".si-card-dates",
  ".si-card-src",
  ".si-card-context",
  ".si-cmte-context",
  ".si-meter-label",
  /* signals-v4 M1 (LD4): the row's reason sentence — one line on the collapsed
     row, cut by an ellipsis, never removed; whole in the opened row. */
  ".si-row-why",
  /* signals-v4 M1 (R3, R24; codex M1 round 1, F3): the statutory range on a
     collapsed row and on a lead card — the only size a reader is shown, so
     it may never vanish at a breakpoint either. */
  ".si-row-amt",
  ".si-card-amt",
  /* signals-v3 M3 (R17, R19, R21, R23, LD9): the ticker page's "each section
     keeps its own clock" line (moved from the lede into the provenance strip),
     a pinned row's "On Signals" marker, and the "Show all N holders"
     disclosure that holds holders 11..N. None may vanish at a breakpoint. */
  ".tk-clock",
  ".on-signals-mark",
  ".tk-holders-more",
  /* signals-v4 M2 (R12, R13, R16, R24, LD10, LD11): the Institutional tab's
     honesty fields — a Congress line's range and dates (its owner, side and
     receipt ride on `.owner-note`, `.si-chip` and `.si-row-src`); a move's
     Δ $, filed date, 13F receipt and Congress count, and its Congress side's
     stated absences; the page's own bound; the Consensus Congress count and
     its qualifying count; the leaders' count and each one's largest new
     position (or the stated absence); the provenance chips (the quarter, the
     newest filing); /institutional/'s pointer to the moved sections. */
  ".cl-amt",
  ".cl-dates",
  ".mv-dv",
  ".mv-fil",
  ".mv-src",
  ".mv-cg",
  ".mv-cong-none",
  ".mv-bound",
  ".cs-cg",
  ".cs-count",
  ".cv-count",
  ".cv-top",
  ".sig-pchip",
  ".inst-moved",
  /* signals-v4 M3 (R18, R19, R21, R24, R25): Overlap's co-occurrence line,
     each row's relation and both sides' counts, and the page's own bound;
     the Playbooks tab's "Not advice" line, its count line, each playbook's
     status and verdict, each finding with its venue, sample and source link;
     a playbook's chip and an opened row's playbook section; the filter's
     live count. None may vanish at a breakpoint. */
  ".ov-lede",
  ".ov-rl",
  ".ov-cg",
  ".ov-mg",
  ".ov-bound",
  ".pb-disc",
  ".pb-count",
  ".pb-st",
  ".pb-verdict",
  ".ev-f",
  ".ev-v",
  ".ev-src",
  ".pb-chip",
  ".si-row-pb",
  ".si-pb-status",
  /* RUN SURFACES-LEGIBILITY, SL-R24 (T12). The note primitive is now the
     channel a large share of this site's explanations travel on — every
     `.col-why`, every footnote clause, the exclusion counts, the owner codes,
     the signal rules. Suppressing either half of it at a breakpoint would hide
     all of that at exactly the width where the page has least room, which is
     the failure mode this sweep exists to catch. `.note-btn` is the reader's
     only cue that an explanation exists; `.note-pop` is the explanation. */
  ".note-btn",
  ".note-pop",
  /* DESIGN-POLISH M1 (H-15, T-17). The ledger's own honesty channels:
     `.note-label` — a label that IS its explanation's trigger
     `.hang`       — a mark (§ † ‡ ≈) hung in the column's slot
     `.c-kind`     — the kind word (BUY, SELL, LATE, NEW, EXIT …)
     `.cell-side`  — the feed row's side, the one cell that says which way
     `.reference-head` — the feed's column head: its labels and their notes are
                     the column definitions, and at ≤1080px it folds away
                     visually, never out of the accessibility tree (review C-12)
     The table foot's reason class is born with T2.1 (M2) and joins then. */
  ".note-label",
  ".hang",
  ".c-kind",
  ".cell-side",
  ".reference-head",
  /* DESIGN-POLISH M2 (T2.1, R12; M1 debt D9): `.table-foot-reason` — the one
     line that says which honesty column a table REMOVED and why (no owner
     qualifier, no flag, an incomplete book). A removed column plus a hidden
     reason is a silent omission, the exact failure column presence forbids. */
  ".table-foot-reason",
  /* SIGNALS-CLARITY M1 (R2, R3): `.footer-notice` — the footer's one notice
     sentence, the §13107(c) prohibited uses and "not financial advice" (or the
     13F caveat) on every page. The full text moved to /methodology; this
     sentence is what stays on the page, so no width may hide it. */
  ".footer-notice",
];
