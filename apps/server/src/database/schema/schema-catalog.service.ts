import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { DatabaseService } from '../database.service.js';
import { buildSnapshot, INTROSPECTION_SQL } from './schema-introspector.js';
import { renderIndex, renderTable, renderTables } from './schema-renderer.js';
import { SchemaRetriever } from './schema-retriever.js';
import type { SchemaContext, SchemaSnapshot, TableInfo } from './schema.types.js';
import { hintCandidates, toHint, valueHintSql } from './value-hints.js';

function globToRegExp(glob: string): RegExp {
  const src = glob
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${src}$`);
}

interface Loaded {
  snapshot: SchemaSnapshot;
  retriever: SchemaRetriever;
  fullText: string;
  hash: string;
}

/**
 * Owns the schema: introspects once, persists to disk (instant warm boots),
 * and builds the smallest prompt context that can answer a question.
 */
@Injectable()
export class SchemaCatalogService implements OnModuleInit {
  private readonly logger = new Logger(SchemaCatalogService.name);
  private loaded?: Loaded;
  private loading?: Promise<Loaded>;

  constructor(
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const raw = await readFile(this.config.get('SCHEMA_CACHE_FILE'), 'utf8');
      const snapshot = JSON.parse(raw) as SchemaSnapshot;
      if (snapshot.database === this.config.get('DB_NAME')) {
        this.loaded = this.prepare(snapshot);
        this.logger.log(
          `Schema loaded from cache: ${this.loaded.snapshot.tables.length} objects (${snapshot.generatedAt})`,
        );
      }
    } catch {
      // No cache yet: introspect lazily on first use so boot never waits on the DB.
    }
  }

  async snapshot(): Promise<SchemaSnapshot> {
    return (await this.ensure()).snapshot;
  }

  async hash(): Promise<string> {
    return (await this.ensure()).hash;
  }

  async refresh(): Promise<SchemaSnapshot> {
    this.loaded = undefined;
    return (await this.ensure(true)).snapshot;
  }

  async table(id: string): Promise<TableInfo> {
    const t = (await this.snapshot()).tables.find((x) => x.id.toLowerCase() === id.toLowerCase());
    if (!t) throw new NotFoundException(`Unknown table "${id}"`);
    return t;
  }

  async describe(ids: string[]): Promise<string> {
    const { snapshot } = await this.ensure();
    const wanted = new Set(ids.map((i) => i.toLowerCase()));
    const found = snapshot.tables.filter(
      (t) => wanted.has(t.id.toLowerCase()) || wanted.has(t.name.toLowerCase()),
    );
    return found.length ? renderTables(found) : 'No matching tables.';
  }

  async search(query: string, limit = 15): Promise<TableInfo[]> {
    return (await this.ensure()).retriever.rank(query, limit);
  }

  /** Smallest schema text likely to answer `question`. */
  async contextFor(question: string): Promise<SchemaContext> {
    const { snapshot, retriever, fullText, hash } = await this.ensure();
    const maxChars = this.config.get('SCHEMA_FULL_CONTEXT_MAX_CHARS');
    if (fullText.length <= maxChars) {
      return { text: fullText, tables: snapshot.tables.map((t) => t.id), full: true, schemaHash: hash };
    }

    let picked = retriever.rank(question, this.config.get('SCHEMA_MAX_TABLES'));
    if (picked.length === 0) {
      // Nothing matched lexically: offer the largest tables as a starting point.
      picked = [...snapshot.tables]
        .sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))
        .slice(0, this.config.get('SCHEMA_MAX_TABLES'));
    }
    const detail = picked.map(renderTable).join('\n');
    const pickedIds = new Set(picked.map((t) => t.id));
    const rest = snapshot.tables.filter((t) => !pickedIds.has(t.id));
    const budget = Math.max(1000, maxChars - detail.length);
    const text = rest.length
      ? `${detail}\n\nOther objects (names only; ask for columns if needed): ${renderIndex(rest, budget)}`
      : detail;
    return { text, tables: [...pickedIds], full: false, schemaHash: hash };
  }

  private ensure(force = false): Promise<Loaded> {
    if (this.loaded && !force) return Promise.resolve(this.loaded);
    this.loading ??= this.introspect()
      .then((l) => (this.loaded = l))
      .finally(() => (this.loading = undefined));
    return this.loading;
  }

  private async introspect(): Promise<Loaded> {
    const started = performance.now();
    const recordsets = await this.db.internalQuery(INTROSPECTION_SQL);
    // Cache the unfiltered snapshot so changing SCHEMA_INCLUDE/EXCLUDE never needs a re-introspect.
    const snapshot = buildSnapshot(this.config.get('DB_NAME'), recordsets);
    if (this.config.get('SCHEMA_VALUE_HINTS')) await this.sampleValues(this.applyFilters(snapshot).tables);
    this.logger.log(
      `Introspected ${snapshot.tables.length} objects in ${Math.round(performance.now() - started)}ms`,
    );
    const file = this.config.get('SCHEMA_CACHE_FILE');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(snapshot));
    return this.prepare(snapshot);
  }

  /** Fills `column.values` in place. Failures (timeouts, permissions) just leave a column without hints. */
  private async sampleValues(tables: TableInfo[]): Promise<void> {
    const maxDistinct = this.config.get('SCHEMA_VALUE_HINTS_MAX_DISTINCT');
    const queue = hintCandidates(tables, {
      maxDistinct,
      maxTableRows: this.config.get('SCHEMA_VALUE_HINTS_MAX_TABLE_ROWS'),
      maxColumns: this.config.get('SCHEMA_VALUE_HINTS_MAX_COLUMNS'),
      exclude: this.config.get('SCHEMA_VALUE_HINTS_EXCLUDE'),
    });
    let sampled = 0;
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const [rows = []] = await this.db.internalQuery(valueHintSql(item.table, item.column, maxDistinct));
          item.column.values = toHint(rows as { v: unknown }[], maxDistinct);
          if (item.column.values) sampled++;
        } catch (err) {
          this.logger.debug(
            `Value hints skipped for ${item.table.id}.${item.column.name}: ${(err as Error).message}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    this.logger.log(`Value hints: ${sampled} categorical columns`);
  }

  private applyFilters(s: SchemaSnapshot): SchemaSnapshot {
    const include = this.config.get('SCHEMA_INCLUDE').map(globToRegExp);
    const exclude = this.config.get('SCHEMA_EXCLUDE').map(globToRegExp);
    const tables = s.tables.filter((t) => {
      const id = t.id.toLowerCase();
      if (include.length && !include.some((r) => r.test(id))) return false;
      return !exclude.some((r) => r.test(id));
    });
    return { ...s, tables };
  }

  private prepare(raw: SchemaSnapshot): Loaded {
    const snapshot = this.applyFilters(raw);
    const fullText = renderTables(snapshot.tables);
    return {
      snapshot,
      retriever: new SchemaRetriever(snapshot.tables),
      fullText,
      hash: createHash('sha256').update(fullText).digest('hex').slice(0, 16),
    };
  }
}
