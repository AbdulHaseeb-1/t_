import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A small durable JSON document on disk: loaded once, written atomically
 * (temp file + rename, so a crash never leaves half a file), and with writes
 * serialized so concurrent updates cannot interleave. Enough for the tens to
 * low thousands of records that templates, schedules and the inbox hold.
 */
export class JsonStore<T> {
  private value?: T;
  private loading?: Promise<T>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly empty: () => T,
  ) {}

  async read(): Promise<T> {
    if (this.value !== undefined) return this.value;
    this.loading ??= readFile(this.file, 'utf8').then(
      (raw) => (this.value = JSON.parse(raw) as T),
      (err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw new Error(`Cannot read ${this.file}: ${err.message}`);
        return (this.value = this.empty());
      },
    );
    return this.loading;
  }

  /** Applies `fn` to the current value and persists the result; returns what `fn` returned. */
  update<R>(fn: (value: T) => R): Promise<R> {
    const run = this.queue.then(async () => {
      const value = await this.read();
      const out = fn(value);
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify(value, null, 2));
      await rename(tmp, this.file);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
