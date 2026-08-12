/* RUN M2-11 T5 (plan R22, LD-10) — the ONE byte-bounded shard filler.

   Generalized from the activity feed's paginator, which was activity-specific
   and TRUNCATED past its shard cap (verified — that behaviour is preserved for
   activity, which states its truncation on every surface). The filer tail must
   never truncate: a published filer missing from its shard family is a dead
   long-tail entity, so the filer-facing entry point FAILS the build instead.
   Both consumers share this fill algorithm, so "where a page ends" has exactly
   one implementation — the same property the activity module already pinned
   against `inst_budget.py`.

   Bytes are MEASURED on the serialized JSON that is actually emitted
   (`Buffer.byteLength`), never estimated from an item count. The envelope
   overhead is the CALLER's to reserve (measured on its own worst-case
   envelope), because only the caller knows its envelope shape.

   Server-only usage in practice (build-time shard planning), but the module
   itself is pure — no `node:` imports beyond the ambient Buffer. */

/** LD-10 client-response ceiling. Every individual tail response is at most
    1 MiB; a large filer may require a separately bounded multi-response range.
    This is the reader's per-response bound, not the provider's 25 MiB limit. */
export const SHARD_RESPONSE_CEILING_BYTES = 1_048_576;

/** One serialized member of a shard. `json` is the exact bytes the item
    contributes to the shard body (for an object envelope: the `"key":{...}`
    pair). `deps` are shared-dictionary entries the item requires; a dep is
    charged to a shard ONCE no matter how many of its items reference it. */
export interface ShardableItem {
  key: string;
  json: string;
  deps?: readonly ShardDep[];
}

interface ShardDep {
  key: string;
  serialized: string;
}

interface FillLimits {
  /** Hard byte ceiling per shard, measured on projected serialized output. */
  ceilingBytes: number;
  /** Envelope reservation — the caller's measured worst-case envelope bytes. */
  overheadBytes: number;
  /** Items per shard; binds when it binds before the byte ceiling. */
  itemLimit: number;
  /** Maximum shards the walk may produce. */
  shardLimit: number;
}

interface FilledShard {
  /** Items consumed by this shard, in input order (shards partition a prefix). */
  itemKeys: string[];
  itemJsons: string[];
  /** Dep keys charged to this shard, in first-reference order. */
  depKeys: string[];
  /** Projected bytes: overhead + items + deps + separators. An upper bound the
      emitted body can only come in under (the caller reserves worst case). */
  projectedBytes: number;
}

interface FillPolicy {
  /** What to do with items that do not fit inside `shardLimit` shards.
      "truncate" returns them as `droppedCount` (activity: stated, never
      silent); "fail" throws — the filer family never truncates. */
  onOverflow: "fail" | "truncate";
  /** A single item whose own cost exceeds the ceiling. "own-shard" lets it
      occupy a shard alone (activity, under the 2 MiB/25 MiB pair); "fail"
      throws naming the item — LD-10: an oversized dedicated shard would
      silently break the owner's 1 MiB invariant, so it is a build STOP, not an
      exception (round-6 N1). */
  onOversizedItem: "fail" | "own-shard";
  /** Noun for error messages, e.g. "filer" — a failure must name the item. */
  itemNoun?: string;
}

interface FillResult {
  shards: FilledShard[];
  /** Items that did not fit ("truncate" policy only; always 0 under "fail"). */
  droppedCount: number;
}

/**
 * Fill ordered items into shards. A shard closes when the NEXT item would carry
 * it past the byte ceiling, or when the item limit is reached — whichever binds
 * first. A shard always accepts its first item, so the walk cannot stall; what
 * happens when that first item alone exceeds the ceiling is `onOversizedItem`'s
 * decision, and what happens past `shardLimit` is `onOverflow`'s.
 *
 * The byte accounting is the activity paginator's, verbatim: each item costs
 * its own serialized bytes plus one separator when it is not the shard's first,
 * and each dep not already in the shard costs its serialized bytes plus one
 * separator when it is not the shard's first dep.
 */
export function fillShardsByBytes(
  items: readonly ShardableItem[],
  limits: FillLimits,
  policy: FillPolicy,
): FillResult {
  const noun = policy.itemNoun ?? "item";
  const shards: FilledShard[] = [];
  let i = 0;
  while (i < items.length && shards.length < limits.shardLimit) {
    const shard: FilledShard = {
      itemKeys: [],
      itemJsons: [],
      depKeys: [],
      projectedBytes: limits.overheadBytes,
    };
    const present = new Set<string>();
    while (i < items.length && shard.itemKeys.length < limits.itemLimit) {
      const item = items[i]!;
      let cost = Buffer.byteLength(item.json) + (shard.itemJsons.length > 0 ? 1 : 0);
      const fresh: ShardDep[] = [];
      let depCount = present.size;
      for (const dep of item.deps ?? []) {
        if (present.has(dep.key)) continue;
        cost += Buffer.byteLength(dep.serialized) + (depCount > 0 ? 1 : 0);
        depCount += 1;
        fresh.push(dep);
      }
      if (shard.projectedBytes + cost > limits.ceilingBytes && shard.itemKeys.length > 0) break;
      shard.itemKeys.push(item.key);
      shard.itemJsons.push(item.json);
      for (const dep of fresh) {
        present.add(dep.key);
        shard.depKeys.push(dep.key);
      }
      shard.projectedBytes += cost;
      i += 1;
      // The item alone exceeds the ceiling: either it owns this shard
      // (activity's documented behaviour) or the build stops here (LD-10).
      if (shard.projectedBytes > limits.ceilingBytes) {
        if (policy.onOversizedItem === "fail") {
          throw new Error(
            `${noun} ${JSON.stringify(item.key)} serializes to ${shard.projectedBytes} projected ` +
              `bytes on its own shard, over the ${limits.ceilingBytes}-byte ceiling (LD-10). ` +
              `An oversized dedicated shard would silently break the 1 MiB client-response ` +
              `invariant, so this is a build STOP for an architecture decision — raise the ` +
              `ceiling or adopt an intra-filer pagination contract via review, never widen here.`,
          );
        }
        break;
      }
    }
    shards.push(shard);
  }
  const dropped = items.length - i;
  if (dropped > 0 && policy.onOverflow === "fail") {
    throw new Error(
      `${dropped} ${noun}(s) do not fit inside the ${limits.shardLimit}-shard budget at the ` +
        `${limits.ceilingBytes}-byte ceiling. This family never truncates: a published ${noun} ` +
        `missing from its shard is unreachable, so the build stops for an architecture decision.`,
    );
  }
  return { shards, droppedCount: dropped };
}

/* ---------- the filer-facing planner: FAIL, never truncate (R22) ---------- */

export interface ShardEntry {
  key: string;
  /** The exact serialized bytes this entry contributes to the shard body. */
  json: string;
}

interface PlannedShard {
  index: number;
  entries: ShardEntry[];
  projectedBytes: number;
}

export interface ShardPlan {
  shards: PlannedShard[];
  totalItems: number;
  ceilingBytes: number;
}

interface PaginateByBytesOptions {
  /** Defaults to the LD-10 client-response ceiling. */
  ceilingBytes?: number;
  /** Measured worst-case envelope bytes; defaults to 0 (bare concatenation). */
  overheadBytes?: number;
  itemLimit?: number;
  shardLimit?: number;
  itemNoun?: string;
}

/**
 * Byte-bounded shard plan over ordered items — the R22 planner. Unlike the
 * activity walk this NEVER truncates and NEVER grants an oversized item a
 * dedicated shard: both are thrown errors naming the item or the shortfall,
 * because a silent cut or a silent widening each break a published invariant
 * (completeness of the routing index; the LD-10 ceiling).
 */
export function paginateByBytes(
  items: readonly ShardableItem[],
  opts: PaginateByBytesOptions = {},
): ShardPlan {
  const ceilingBytes = opts.ceilingBytes ?? SHARD_RESPONSE_CEILING_BYTES;
  const { shards } = fillShardsByBytes(
    items,
    {
      ceilingBytes,
      overheadBytes: opts.overheadBytes ?? 0,
      itemLimit: opts.itemLimit ?? Number.MAX_SAFE_INTEGER,
      shardLimit: opts.shardLimit ?? Number.MAX_SAFE_INTEGER,
    },
    { onOverflow: "fail", onOversizedItem: "fail", itemNoun: opts.itemNoun ?? "item" },
  );
  return {
    shards: shards.map((s, index) => ({
      index,
      entries: s.itemKeys.map((key, k) => ({ key, json: s.itemJsons[k]! })),
      projectedBytes: s.projectedBytes,
    })),
    totalItems: items.length,
    ceilingBytes,
  };
}
