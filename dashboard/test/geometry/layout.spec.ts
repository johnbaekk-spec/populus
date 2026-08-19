/* R35 — layout defects verified by REAL browser geometry, at five widths.

   Every other test in this repo can only see markup or CSS text. A rule that
   exists is not the claim being made here; the claim is that two boxes do not
   occupy the same pixels. R4, R5, R7 and R9 are all defined against rendered
   geometry precisely because their defects were invisible to markup tests —
   the masthead collided for months while every DOM assertion passed.

   These must FAIL on a reintroduced overlap. `layout-negative.spec.ts` proves
   that by injecting one. */

import { test, expect, type Page, type Locator } from "@playwright/test";
import { WIDTHS } from "../../playwright.config.ts";

import {
  overlap,
  stripRowTrailing,
  PACKED_TRAILING_PX,
  CONGRESS_TILE_LABELS,
  FORCE_TABLE_OVERFLOW,
  WORST_CASE_MEMBER,
  intrinsicWidth,
  type Box,
} from "./geometry.ts";

/** Exactly 40 characters — R5's Verification Matrix boundary case. The length
    is asserted at use, not trusted to this comment. */
const WORST_CASE_IDENTITY = "BLACKROCK LIQUIDITY TREASURY TRUST FD II";

/** Visible boxes only — a `display:none` burger has no geometry to protect. */
async function boxesOf(page: Page, selectors: string[]): Promise<{ sel: string; box: Box }[]> {
  const out: { sel: string; box: Box }[] = [];
  for (const sel of selectors) {
    const el: Locator = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (box && box.width > 0 && box.height > 0) out.push({ sel, box });
  }
  return out;
}

for (const width of WIDTHS) {
  test.describe(`@${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    test("R4: no two masthead elements occupy the same pixels", async ({ page }) => {
      await page.goto("/");
      const parts = await boxesOf(page, [
        ".brand",
        ".site-nav",
        ".site-search",
        ".theme-toggle",
        ".nav-burger",
        ".search-toggle",
      ]);
      expect(parts.length, "the masthead rendered something to measure").toBeGreaterThan(1);
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i]!, b = parts[j]!;
          expect(
            overlap(a.box, b.box),
            `${a.sel} and ${b.sel} intersect at ${width}px — the masthead is painting over itself`,
          ).toBe(0);
        }
      }
    });

    test("R4: exactly one build watermark, and it is in the footer", async ({ page }) => {
      await page.goto("/");
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const ids = body.match(/build \d{8}\.\d+/g) ?? [];
      expect(ids.length, `build id renders ${ids.length} times, expected 1`).toBe(1);
      const inFooter = await page.locator("footer").innerText();
      expect(inFooter).toContain(ids[0]!);
    });

    test("nothing overflows the page horizontally", async ({ page }) => {
      await page.goto("/congress/");
      /* Name the culprit. "The page is 200px too wide" sends the reader
         hunting; "this element's right edge is at 1164" does not. */
      const diag = await page.evaluate(() => {
        const limit = window.innerWidth;
        let worst: { sel: string; right: number } | null = null;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          const right = r.right + window.scrollX;
          if (right > limit + 1 && (!worst || right > worst.right)) {
            const id = el.id ? `#${el.id}` : "";
            const cls = el.className && typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
              : "";
            worst = { sel: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(right) };
          }
        }
        return { over: document.documentElement.scrollWidth - limit, limit, worst };
      });
      expect(
        diag.over,
        `the page scrolls sideways by ${diag.over}px at ${width}px — widest offender: ` +
          `${diag.worst?.sel ?? "unknown"} reaching x=${diag.worst?.right} against a ${diag.limit}px viewport`,
      ).toBeLessThanOrEqual(1);
    });

    test("R5: no feed cell paints over its neighbour", async ({ page }) => {
      await page.goto("/congress/");
      const rows = page.locator(".feed-row");
      const n = Math.min(await rows.count(), 12);
      expect(n, "the feed rendered rows to measure").toBeGreaterThan(0);
      /* F9 (codex round 1). R5's matrix row names a 40-CHARACTER identity, and
         sampling whatever twelve rows today's corpus happens to put first does
         not exercise it — the worst case is only present by luck. Plant it.

         F5 (codex round 2): the previously planted string was 37 characters, so
         the 38–40 boundary the matrix row names was still untested. The length
         is asserted here rather than trusted to a hand count — that is exactly
         how it drifted the first time. */
      expect(WORST_CASE_IDENTITY, "R5's matrix row names a 40-character identity").toHaveLength(40);
      const planted = await rows.first().evaluate((row, identity) => {
        const cell = row.querySelector(".cell-ticker");
        if (!cell) return false;
        cell.innerHTML =
          '<span class="asset-name"><span aria-hidden="true">' + identity + "</span></span>";
        return true;
      }, WORST_CASE_IDENTITY);
      expect(planted, "row 0 must carry a ticker cell to plant the worst case in").toBe(true);
      for (let r = 0; r < n; r++) {
        const cells = rows.nth(r).locator(".cell");
        const boxes: { i: number; box: Box }[] = [];
        for (let c = 0; c < (await cells.count()); c++) {
          const el = cells.nth(c);
          if (!(await el.isVisible())) continue;
          /* Out-of-flow cells are EXCLUDED, and this is not a loophole. The
             mobile fold lifts `.cell-star` out of the grid and parks it in the
             row's top-right corner, clearing the text with `padding-right` on
             `.row-line1`. Its box legitimately overlaps its neighbours' boxes
             while no glyph ever does. Comparing it would report a collision
             that does not exist, and a check that cries wolf gets muted. */
          const flow = await el.evaluate((n) => getComputedStyle(n).position);
          if (flow === "absolute" || flow === "fixed") continue;
          const box = await el.boundingBox();
          if (box && box.width > 0) boxes.push({ i: c, box });
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(
              overlap(boxes[i]!.box, boxes[j]!.box),
              `row ${r}: cells ${boxes[i]!.i} and ${boxes[j]!.i} intersect at ${width}px`,
            ).toBe(0);
          }
        }
      }
    });

    test("R9: the stat strip fits, packs its rows, and shows only tiles it has data for", async ({ page }) => {
      await page.goto("/congress/");
      const strip = page.locator(".tiles").first();
      expect(await strip.count(), "the congress page renders a stat strip").toBeGreaterThan(0);
      const stripBox = (await strip.boundingBox())!;
      const tiles = strip.locator(".tile");
      const count = await tiles.count();
      expect(count, "a rendered strip must hold tiles").toBeGreaterThan(0);

      /* F4 (codex round 1). The old assertion skipped whenever the strip
         wrapped — which, after the R9 fix, is exactly the widths that used to
         overflow. It therefore ran only where nothing was ever broken. The
         invariant that holds at EVERY width: the strip stays inside its parent,
         and every row except the last is packed. Trailing space on the final
         row is a ragged line end; trailing space on an earlier row means the
         strip reserved width it did not use.

         This first ran RED at 360px (6.5px) and 720px (191px), and the CSS is
         what changed, not the number: `.tiles` paints `var(--rule2)` behind a
         1px gap grid, so an unpacked row renders that unused width as a visible
         rule-coloured slab inside the bordered strip — R9's "unoccupied trailing
         area", literally. `.tile` grows to consume it now. See
         `PACKED_TRAILING_PX` for why 6 is not a tuned threshold. */
      const parentBox = (await strip.evaluate((el) => {
        const r = el.parentElement!.getBoundingClientRect();
        return { x: r.x, width: r.width };
      }))!;
      expect(
        Math.round(stripBox.x + stripBox.width),
        `the strip overflows its parent at ${width}px`,
      ).toBeLessThanOrEqual(Math.round(parentBox.x + parentBox.width) + 1);

      const trailing = await strip.evaluate(stripRowTrailing);
      /* F2 (codex round 2): EVERY row, the last one included. Excluding the
         final row was inherited from the pre-fix layout, where a ragged last
         line was unavoidable. It is not unavoidable any more — `flex: 1 1 auto`
         fills the final row too, measured at 1.0px like every other — so the
         exclusion only carved out a hole a regression could sit in: a
         rule-coloured slab after the last row would have passed. */
      for (let r = 0; r < trailing.length; r++) {
        expect(
          trailing[r]!,
          `row ${r} of ${trailing.length} in the strip leaves ${Math.round(trailing[r]!)}px ` +
            `unused at ${width}px — the strip is reserving width it does not use`,
        ).toBeLessThanOrEqual(PACKED_TRAILING_PX);
      }

      /* F5 (codex round 1) / F3 (codex round 2): the other half of R9's matrix
         row. "Tile count equals data" is not "no tile is blank" — a strip that
         DROPPED a tile would also have no blank one, and the plan's defect #5 is
         a tile appearing that the data does not support. So the count and the
         identities are both pinned.

         `buildTiles` (`lib/data.ts:783`) returns exactly four tiles with no
         branch that adds or removes one, so four is structural, not a snapshot
         of today's corpus. The labels are matched as PATTERNS: their shape is
         the contract, the numbers inside them are the corpus and may move. */
      const rendered = await strip.evaluate((el) =>
        [...el.querySelectorAll(".tile")]
          /* VISIBLE tiles only, and that is the point rather than a detail. A
             tile hidden by a media query still answers `querySelectorAll`, so
             counting the DOM would let the fold delete a coverage figure and
             still read as "tile count equals data" — §8 forbids honesty-bearing
             content being media-query-hidden, so the count has to mean what a
             reader can actually see. */
          .filter((t) => {
            const r = t.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((t) => ({
            label: (t.querySelector(".tile-label")?.textContent ?? "").trim(),
            value: (t.querySelector(".tile-value")?.textContent ?? "").trim(),
          })),
      );
      expect(
        rendered.length,
        `the strip renders ${rendered.length} VISIBLE tiles at ${width}px; buildTiles emits ` +
          `${CONGRESS_TILE_LABELS.length} and has no branch that adds or drops one`,
      ).toBe(CONGRESS_TILE_LABELS.length);
      for (let i = 0; i < CONGRESS_TILE_LABELS.length; i++) {
        expect(
          rendered[i]!.label,
          `tile ${i} at ${width}px is labelled "${rendered[i]!.label}", which is not the ` +
            `data-backed tile expected in that position`,
        ).toMatch(CONGRESS_TILE_LABELS[i]!);
        expect(
          rendered[i]!.value,
          `tile ${i} ("${rendered[i]!.label}") renders no value at ${width}px`,
        ).not.toBe("");
      }
    });

    test("R7: an ordinary member name renders in full, and no stat tile is clipped", async ({ page }) => {
      await page.goto("/congress/");

      /* R7's matrix row names a 20-CHARACTER member name at 964px. Planted, not
         sampled for: whether today's corpus happens to contain a 20-character
         name is not something the gate should depend on, and round 2's F5 was
         exactly this mistake made with a "40-character" string that was 37. */
      expect(WORST_CASE_MEMBER, "R7's matrix row names a 20-character name").toHaveLength(20);

      const cell = page.locator(".feed-row .cell-member").first();
      expect(await cell.count(), "the feed renders a member cell").toBeGreaterThan(0);

      /* Serialized the same way `stripRowTrailing` is — Playwright ships the
         function itself into the page. No `new Function`: R36 locks a CSP that
         forbids exactly that, and a gate that needs `unsafe-eval` to run would
         have to be unpicked the moment the policy lands. */
      await cell.evaluate((el, name) => {
        const nameEl = el.querySelector(".member-name") ?? el.firstElementChild ?? el;
        nameEl.textContent = name;
      }, WORST_CASE_MEMBER);
      const fit = {
        need: await cell.evaluate(intrinsicWidth),
        have: await cell.evaluate((el) => el.clientWidth),
      };

      /* `scrollWidth > clientWidth` cannot answer this: the cell clips with
         `text-overflow: ellipsis`, so it reports scrollWidth === clientWidth
         whether it has room to spare or is cutting a name in half. The clone is
         measured at `width: max-content` instead. */
      /* The matrix row's own boundary: "20-char member name not truncated **at
         964px**; no clipped stat tile **from 360px**". Two different widths,
         deliberately, so the name half is asserted from 964px up and the tile
         half at every width — that is the spec, not a convenience.

         It is NOT a quiet skip, and here is the thing it would otherwise hide:
         at 360px the member cell measures **8px**, because `.cell-ticker` is
         `flex-shrink: 0` and a 194px fund name eats the line, leaving the
         member's `flex: 1 1 auto` nothing to take. A name reduced to 8px is
         deleted in practice. That is REAL, it is PRE-EXISTING (measured before
         this change and unaffected by it — the fold's flex rules are carried
         over unaltered), and it is competition between two cells rather than
         the starved `1fr` track R7 names. Filed as B30 rather than folded into
         R7 silently or "fixed" by loosening this assertion. */
      if (width >= 964) {
        expect(
          fit.need,
          `a 20-character member name needs ${fit.need}px and the cell gives it ` +
            `${fit.have}px at ${width}px — the name is truncated, which is the ` +
            `defect R7 exists for`,
        ).toBeLessThanOrEqual(fit.have);
      } else {
        /* Below the matrix row's width this still must not silently pass as
           coverage: assert the measurement HAPPENED and record it. */
        expect(fit.have, `the member cell has no measurable box at ${width}px`).toBeGreaterThan(0);
      }

      /* The other half of the row: no stat tile is clipped from 360px up. The
         value and the label are checked separately — a tile whose LABEL clips
         still loses the thing that says what the number means. */
      const clipped = await page.locator(".tiles").first().evaluate((strip) =>
        [...strip.querySelectorAll(".tile")]
          .flatMap((t) => [
            { part: "value", el: t.querySelector(".tile-value") },
            { part: "label", el: t.querySelector(".tile-label") },
          ])
          .filter((x) => x.el && x.el.scrollWidth > x.el.clientWidth + 1)
          .map((x) => `${x.part}:"${(x.el!.textContent ?? "").trim().slice(0, 24)}"`),
      );
      expect(
        clipped,
        `${clipped.length} stat tile part(s) are clipped at ${width}px: ${clipped.join(", ")}`,
      ).toEqual([]);
    });

    test("R6: a scrollable table announces itself and pins its identity column", async ({ page }) => {
      /* F6 (codex round 1): this was pinned at 964px and so tested one width of
         the five it is specified against. It lives in the width loop now. */
      await page.goto("/institutional/filers/1067983/");
      const scroller = page.locator(".table-scroll").first();
      /* No early `return`s here, deliberately. Three of them used to guard this
         test — missing scroller, not-scrollable, missing sticky cell — and each
         was a silent PASS that would read as coverage.

         F4/F2 (codex rounds 2 and 3). Removing the guards was not enough: at
         1440px the real table measures 1278/1278, so the widest width asserted a
         cue on a container that CANNOT scroll. Worse, the only pixel difference
         there was 10px in from the edge — the `local` cover layer, not the
         shadow — so it was evidence about the wrong layer entirely.

         The overflow is forced now, with an instrument that took three
         contradictory measurements to get right (see `FORCE_TABLE_OVERFLOW`).
         Scrollability is ASSERTED rather than computed and discarded, and the
         cue is asserted as PAINT rather than as a computed declaration: a
         gradient in `background-image` does not prove anything reaches the
         screen, because these shadows are painted on the container BEHIND the
         table. Both frames come from this same run, so no baseline is stored and
         no copy change can turn this red. */
      expect(await scroller.count(), "the filer page renders a scroll container").toBeGreaterThan(0);
      await page.addStyleTag({ content: FORCE_TABLE_OVERFLOW });

      const box = (await scroller.boundingBox())!;
      const state = await scroller.evaluate((el) => {
        el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
        const r = el.getBoundingClientRect();
        const th = el.querySelector("thead");
        const headH = th ? th.getBoundingClientRect().height : 0;
        const at = document.elementFromPoint(r.right - 6, r.top + headH + 40);
        return {
          scrollable: el.scrollWidth > el.clientWidth,
          sw: el.scrollWidth,
          cw: el.clientWidth,
          headH: Math.round(headH),
          edgeBg: at ? getComputedStyle(at).backgroundColor : "none",
          background: getComputedStyle(el).backgroundImage,
        };
      });

      expect(
        state.scrollable,
        `the table does not overflow at ${width}px (${state.sw}/${state.cw}) even when forced — ` +
          `every cue assertion below would be vacuous`,
      ).toBe(true);
      /* Guard the instrument itself: if the edge cell is opaque, the cue is
         occluded and a red result would be the harness's own doing. */
      expect(
        state.edgeBg,
        `an OPAQUE cell (${state.edgeBg}) covers the container's right edge at ${width}px — ` +
          `the forcing instrument has distorted the layout, so the cue check below is invalid`,
      ).toBe("rgba(0, 0, 0, 0)");
      expect(
        state.background,
        `at ${width}px a table scrolls sideways with no cue — it hides its columns ` +
          `as surely as deleting them`,
      ).toContain("gradient");

      const clip = { x: box.x + box.width - 12, y: box.y + state.headH + 40, width: 10, height: 60 };
      const withCue = await page.screenshot({ clip });
      await page.addStyleTag({ content: ".table-scroll{background-image:none}" });
      const withoutCue = await page.screenshot({ clip });
      expect(
        withCue.equals(withoutCue),
        `at ${width}px (${state.sw}/${state.cw}) the scroll cue is declared but paints ` +
          `nothing at the container's right edge — it renders identically with and without it`,
      ).toBe(false);

      const firstCell = page.locator(".etable[data-sticky-first] td:first-child").first();
      expect(await firstCell.count(), "the changes table pins an identity column").toBeGreaterThan(0);
      expect(
        await firstCell.evaluate((el) => getComputedStyle(el).position),
        `at ${width}px the identity column scrolls away with the data it identifies`,
      ).toBe("sticky");
    });
  });
}
