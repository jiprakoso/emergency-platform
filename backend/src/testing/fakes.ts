import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { FindOperator, Repository } from 'typeorm';
import type { Redis } from 'ioredis';

/**
 * Fake repository & Redis in-memory untuk tes (Jest).
 *
 * Tujuannya menutup lapisan persistensi saja: layanan yang diuji tetap nyata
 * (kripto, rotasi sesi, matriks permission). Bila muncul SQL yang belum
 * diterjemahkan, fake ini melempar galat supaya tes gagal dengan jelas, bukan
 * diam-diam lolos.
 */

type Row = Record<string, unknown>;

export type FindOptionsLike = {
  where?: unknown;
  order?: Record<string, 'ASC' | 'DESC'>;
  select?: unknown;
  relations?: unknown;
};

export type FakeRepositoryOptions<T> = {
  rows?: T[];
  /** Penerjemah hasil mentah `getRawMany` (mis. matriks role → permission). */
  rawResolver?: (params: Row) => Row[];
};

function sameValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

function matchesWhere(row: Row, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  if (Array.isArray(where)) return where.some((w) => matchesWhere(row, w));
  if (typeof where !== 'object') {
    throw new Error(`FakeRepository: bentuk where tak didukung: ${String(where)}`);
  }
  return Object.entries(where as Row).every(([key, expected]) => {
    const actual = row[key];
    if (expected instanceof FindOperator) {
      switch (expected.type) {
        case 'isNull':
          return actual === null || actual === undefined;
        case 'not':
          return !sameValue(actual, expected.value);
        case 'in':
          return (expected.value as unknown[]).some((v) => sameValue(actual, v));
        default:
          throw new Error(`FakeRepository: operator FindOperator '${expected.type}' belum didukung`);
      }
    }
    return sameValue(actual, expected);
  });
}

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function applyOrder<T>(rows: T[], order?: Record<string, 'ASC' | 'DESC'>): T[] {
  if (!order) return rows;
  const entry = Object.entries(order)[0];
  if (!entry) return rows;
  const [key, direction] = entry;
  return [...rows].sort((a, b) => {
    const cmp = compareValues((a as Row)[key], (b as Row)[key]);
    return direction === 'DESC' ? -cmp : cmp;
  });
}

/** Evaluasi satu klausa `col = :param` / `col = 'literal'` terhadap satu baris. */
function evalCondition(row: Row, condition: string, params: Row): boolean {
  const cleaned = condition.trim().replace(/^\(+|\)+$/g, '');
  const match = cleaned.match(/^([\w.]+)\s*=\s*(:\w+|'[^']*')$/);
  if (!match) {
    throw new Error(`FakeRepository: kondisi SQL tak didukung: '${cleaned}'`);
  }
  const [, columnRef, rhs] = match;
  const rawColumn = columnRef.includes('.') ? columnRef.slice(columnRef.indexOf('.') + 1) : columnRef;
  // SQL memakai nama kolom `snake_case`; properti entitas memakai `camelCase`.
  const column = rawColumn.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  let expected: unknown;
  if (rhs.startsWith(':')) {
    const name = rhs.slice(1);
    if (!(name in params)) {
      throw new Error(`FakeRepository: parameter '${name}' tidak diberikan pada klausa`);
    }
    expected = params[name];
  } else {
    expected = rhs.slice(1, -1);
  }
  return sameValue(row[column], expected);
}

/** Evaluasi klausa `WHERE` sederhana (AND/OR tanpa kurung bertingkat). */
function evalClause(row: Row, sql: string, params: Row): boolean {
  const normalized = sql.trim();
  const orParts = normalized.split(/\s+OR\s+/i);
  return orParts.some((orPart) => {
    const andParts = orPart.split(/\s+AND\s+/i);
    return andParts.every((condition) => evalCondition(row, condition, params));
  });
}

export class FakeQueryBuilder<T extends object> {
  private readonly clauses: { sql: string; params: Row }[] = [];

  constructor(private readonly repo: FakeRepository<T>) {}

  addSelect(): this {
    return this;
  }
  select(): this {
    return this;
  }
  innerJoin(): this {
    return this;
  }
  where(sql: string, params?: Row): this {
    this.clauses.push({ sql, params: params ?? {} });
    return this;
  }
  andWhere(sql: string, params?: Row): this {
    return this.where(sql, params);
  }

  private matched(): T[] {
    return this.repo.rows.filter((row) =>
      this.clauses.every((clause) => evalClause(row as Row, clause.sql, clause.params)),
    );
  }

  async getOne(): Promise<T | null> {
    return this.matched()[0] ?? null;
  }

  async getMany(): Promise<T[]> {
    return this.matched();
  }

  async getRawMany<R = Row>(): Promise<R[]> {
    const params: Row = this.clauses.reduce<Row>((acc, clause) => ({ ...acc, ...clause.params }), {});
    return this.repo.resolveRaw(params) as R[];
  }
}

/**
 * Repository in-memory: `create`/`save`/`findOne`/`find`/`update`/`increment`
 * dengan pencocokan `where` berbasis objek, plus query builder mini untuk
 * klause SQL sederhana yang dipakai layanan.
 */
export class FakeRepository<T extends object> {
  readonly rows: T[];
  private readonly rawResolver?: (params: Row) => Row[];

  constructor(options: FakeRepositoryOptions<T> = {}) {
    this.rows = options.rows ?? [];
    this.rawResolver = options.rawResolver;
  }

  create(partial: Partial<T>): T {
    return { ...partial } as T;
  }

  async save(entity: T): Promise<T> {
    const target = entity as Row;
    if (target.id === undefined || target.id === null) {
      target.id = randomUUID();
    }
    const key = String(target.id);
    const index = this.rows.findIndex((r) => String((r as Row).id) === key);
    if (index >= 0) {
      this.rows[index] = entity;
    } else {
      this.rows.push(entity);
    }
    return entity;
  }

  async findOne(options: FindOptionsLike = {}): Promise<T | null> {
    const matched = this.rows.filter((row) => matchesWhere(row as Row, options.where));
    return applyOrder(matched, options.order)[0] ?? null;
  }

  async find(options: FindOptionsLike = {}): Promise<T[]> {
    const matched = this.rows.filter((row) => matchesWhere(row as Row, options.where));
    return applyOrder(matched, options.order);
  }

  async update(criteria: unknown, patch: Partial<T>): Promise<{ affected: number }> {
    const matched = this.rows.filter((row) => matchesWhere(row as Row, criteria));
    matched.forEach((row) => Object.assign(row, patch));
    return { affected: matched.length };
  }

  async increment(criteria: unknown, field: string, value: number): Promise<{ affected: number }> {
    const matched = this.rows.filter((row) => matchesWhere(row as Row, criteria));
    matched.forEach((row) => {
      const current = Number((row as Row)[field] ?? 0);
      (row as Row)[field] = current + value;
    });
    return { affected: matched.length };
  }

  createQueryBuilder(_alias?: string): FakeQueryBuilder<T> {
    return new FakeQueryBuilder<T>(this);
  }

  resolveRaw(params: Row): Row[] {
    if (!this.rawResolver) {
      throw new Error('FakeRepository: rawResolver belum diatur untuk query getRawMany');
    }
    return this.rawResolver(params);
  }

  /** SQL mentah sengaja tidak didukung: tes harus memakai jalur layanan. */
  async query(sql: string): Promise<never> {
    throw new Error(`FakeRepository: SQL mentah belum didukung di tes: ${sql.slice(0, 80)}`);
  }
}

/** Bungkus fake agar sesuai tipe `Repository<T>` pada konstruktor layanan. */
export function asRepository<T extends object>(fake: FakeRepository<T>): Repository<T> {
  return fake as unknown as Repository<T>;
}

/** Redis in-memory: cukup untuk `get`/`set(..., 'EX', ttl)`/`del`/`ping`. */
export class FakeRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<'OK'> {
    const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    keys.forEach((key) => {
      if (this.store.delete(key)) removed += 1;
    });
    return removed;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  /** Semua kunci yang tersimpan (untuk asersi pada tes). */
  keys(): string[] {
    return [...this.store.keys()];
  }
}

export function asRedis(fake: FakeRedis): Redis {
  return fake as unknown as Redis;
}

/** ConfigService dengan nilai uji (nilai lain memakai default parameter `get`). */
export function fakeConfig(values: Record<string, unknown> = {}): ConfigService {
  return new ConfigService(values);
}

/**
 * Jalankan promise yang diharapkan melempar, kembalikan galatnya. Bila tidak
 * melempar, tes gagal dengan pesan jelas.
 */
export async function catchError(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as Error & { code?: string };
  }
  throw new Error('diharapkan melempar galat, tetapi berhasil');
}
