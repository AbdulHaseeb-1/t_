export interface ResultColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: ResultColumn[];
  /** Row-major arrays: ~40% smaller than objects on the wire and in prompts. */
  rows: unknown[][];
  rowCount: number;
  /** True when the row cap cut the result short. */
  truncated: boolean;
  elapsedMs: number;
}
