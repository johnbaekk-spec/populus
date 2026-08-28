/* T6.6 (REPOSITORY-PROFESSIONALIZATION Slice 6): the whole-tree stylesheet.

   global.css was split into nine region files imported by Base.astro in exact
   source order. Every CSS contract that used to read global.css reads THIS
   concatenation instead, in the order Base.astro actually imports — parsed
   from Base.astro itself, so a reordering or an added sheet cannot desync the
   tests from the cascade the site ships. */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DASHBOARD = path.resolve(import.meta.dirname, "..", "..");
const BASE_ASTRO = path.join(DASHBOARD, "src", "layouts", "Base.astro");
const STYLES_DIR = path.join(DASHBOARD, "src", "styles");

/** The stylesheet basenames Base.astro imports, in import (cascade) order. */
export function baseStyleImports(): string[] {
  const src = readFileSync(BASE_ASTRO, "utf-8");
  const names = [...src.matchAll(/^import "\.\.\/styles\/([^"]+\.css)";$/gm)].map(
    (m) => m[1]!,
  );
  if (names.length === 0) throw new Error("Base.astro imports no local stylesheets");
  return names;
}

/** Every local stylesheet on disk (sorted; for the no-orphan assertion). */
export function styleFilesOnDisk(): string[] {
  return readdirSync(STYLES_DIR)
    .filter((n) => n.endsWith(".css"))
    .sort();
}

/** The whole-tree stylesheet: the split files concatenated in Base.astro
    import order — byte-equal to the pre-split global.css at the split. */
export function baseStylesheet(): string {
  return baseStyleImports()
    .map((n) => readFileSync(path.join(STYLES_DIR, n), "utf-8"))
    .join("");
}
