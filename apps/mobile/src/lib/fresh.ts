/**
 * Messages created in this session that have not been shown yet. They animate
 * in when they first appear; history loaded from storage, and rows remounted
 * by scrolling, appear without animation.
 */
const fresh = new Set<string>();

export function markFresh(...ids: string[]): void {
  for (const id of ids) fresh.add(id);
}

export function isFresh(id: string): boolean {
  return fresh.has(id);
}

/** Called once the row has mounted, so a later remount does not animate again. */
export function shown(id: string): void {
  fresh.delete(id);
}
