import { InvalidCursorError, decodeCursor, encodeCursor, type PageInfo } from '@photos/shared';
import { and, asc, desc, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export type SortKey<Row> = {
  column: SQLWrapper;
  dir: 'asc' | 'desc';
  /** Nullable columns need an explicit null bucket or they break the keyset. */
  nullable?: boolean;
  read: (row: Row) => string | number | null;
};

export type SortSpec<Row> = {
  /** Fingerprint baked into every cursor. A mismatch is a 400, not a wrong page. */
  id: string;
  keys: SortKey<Row>[];
};

const flip = (d: 'asc' | 'desc'): 'asc' | 'desc' => (d === 'asc' ? 'desc' : 'asc');

/**
 * ORDER BY, with nullability hoisted into an explicit leading key.
 *
 * SQL null ordering differs between ASC and DESC, which would make the
 * keyset predicate direction-dependent for no good reason. Pinning it -- nulls
 * last going forward, nulls first going backward -- makes the null bucket just
 * another sort key, so `sort=taken` paginates like everything else.
 */
export function orderFor<Row>(spec: SortSpec<Row>, reverse: boolean): SQL[] {
  const out: SQL[] = [];
  for (const k of spec.keys) {
    const dir = reverse ? flip(k.dir) : k.dir;
    // `col IS NULL` is 0 or 1: ASC puts non-nulls first, DESC puts nulls first.
    if (k.nullable) out.push(reverse ? desc(sql`${k.column} IS NULL`) : asc(sql`${k.column} IS NULL`));
    out.push(dir === 'asc' ? asc(k.column) : desc(k.column));
  }
  return out;
}

/**
 * Lexicographic keyset predicate:
 *   (k1 OP v1) OR (k1 = v1 AND ((k2 OP v2) OR (k2 = v2 AND ...)))
 *
 * When every key shares a direction and none is nullable we emit PostgreSQL's
 * row-value form -- `(a, b) < (?, ?)` -- which lets the planner seek straight
 * into the composite index instead of evaluating a disjunction per row.
 * Verify with EXPLAIN (ANALYZE, BUFFERS): you want an index scan.
 */
export function keysetPredicate<Row>(
  spec: SortSpec<Row>,
  values: (string | number | null)[],
  reverse: boolean,
): SQL {
  const keys = spec.keys;
  if (values.length !== keys.length) throw new InvalidCursorError('Cursor key arity mismatch.');

  const first = keys[0]!;
  const uniform = keys.every((k) => k.dir === first.dir && !k.nullable);

  if (uniform) {
    const forward = first.dir === 'desc' ? '<' : '>';
    const backward = first.dir === 'desc' ? '>' : '<';
    const op = reverse ? backward : forward;
    const cols = sql.join(keys.map((k) => sql`${k.column}`), sql`, `);
    const vals = sql.join(values.map((v) => sql`${v}`), sql`, `);
    return sql`(${cols}) ${sql.raw(op)} (${vals})`;
  }

  const build = (i: number): SQL => {
    const k = keys[i]!;
    const v = values[i]!;
    const dir = reverse ? flip(k.dir) : k.dir;

    // NULL comparisons are never true in SQL, so `strict` already excludes nulls.
    const strict = dir === 'asc' ? sql`${k.column} > ${v}` : sql`${k.column} < ${v}`;

    // Nulls sit in one bucket at the end (or, going backwards, at the start).
    // Forward from a real value: the nulls are still ahead of you.
    // Forward from inside the null bucket: nothing on this key follows.
    const nullsLast = !reverse;
    const after: SQL = !k.nullable
      ? strict
      : v === null
        ? nullsLast
          ? sql`0`
          : sql`${k.column} IS NOT NULL`
        : nullsLast
          ? sql`(${strict} OR ${k.column} IS NULL)`
          : strict;

    const eq = k.nullable && v === null ? sql`${k.column} IS NULL` : sql`${k.column} = ${v}`;
    return i === keys.length - 1 ? after : sql`(${after} OR (${eq} AND ${build(i + 1)}))`;
  };

  return build(0);
}

export type PaginateOptions<Row> = {
  spec: SortSpec<Row>;
  /** Tenancy + filters, composed by the caller. NEVER derived from the cursor. */
  where: SQL | undefined;
  select: (where: SQL | undefined, order: SQL[], limit: number) => Promise<Row[]>;
  limit: number;
  cursor?: string | undefined;
  secret: string;
};

export async function paginate<Row>(
  opts: PaginateOptions<Row>,
): Promise<{ data: Row[]; pageInfo: PageInfo }> {
  const { spec, limit, cursor, secret } = opts;

  const decoded = cursor ? await decodeCursor(cursor, spec.id, secret) : undefined;
  const reverse = decoded?.d === 'prev';

  const where = decoded
    ? and(opts.where, keysetPredicate(spec, decoded.k, reverse))
    : opts.where;

  // limit + 1: one extra row tells us whether another page exists, without a
  // second query and without COUNT(*).
  const rows = await opts.select(where, orderFor(spec, reverse), limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // A 'prev' page is fetched backwards; the caller always gets display order.
  if (reverse) page.reverse();

  const keyOf = (row: Row) => spec.keys.map((k) => k.read(row));
  const head = page[0];
  const tail = page[page.length - 1];

  const hasNextPage = reverse ? true : hasMore;
  const hasPrevPage = reverse ? hasMore : Boolean(decoded);

  return {
    data: page,
    pageInfo: {
      nextCursor:
        tail && hasNextPage
          ? await encodeCursor({ v: 1, k: keyOf(tail), d: 'next', s: spec.id }, secret)
          : null,
      prevCursor:
        head && hasPrevPage
          ? await encodeCursor({ v: 1, k: keyOf(head), d: 'prev', s: spec.id }, secret)
          : null,
      hasNextPage,
      hasPrevPage,
      limit,
    },
  };
}

/** Walks every page of a keyset query. Used by the ZIP builder and the seeder. */
export async function* keysetWalk<Row>(
  opts: Omit<PaginateOptions<Row>, 'cursor'> & { pageSize?: number },
): AsyncGenerator<Row> {
  let cursor: string | undefined;
  for (;;) {
    const { data, pageInfo } = await paginate({ ...opts, cursor, limit: opts.pageSize ?? opts.limit });
    for (const row of data) yield row;
    if (!pageInfo.hasNextPage || !pageInfo.nextCursor) return;
    cursor = pageInfo.nextCursor;
  }
}
