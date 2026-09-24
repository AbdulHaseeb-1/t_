import type { STRINGS } from '../i18n';
import { ApiError, normalizeBaseUrl } from './api';

type Strings = (typeof STRINGS)['en'];

/** Errors the user fixes in Settings (address or key), so the UI can offer a shortcut there. */
export function needsSettings(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === 'unconfigured' || err.kind === 'network' || err.kind === 'auth');
}

/** User-facing error text in the interface language; server details are kept where they help. */
export function describeError(err: unknown, t: Strings, baseUrl: string): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : t.errServer;
  switch (err.kind) {
    case 'unconfigured':
      return t.errNoServer;
    case 'network':
      return t.errNetwork(normalizeBaseUrl(baseUrl));
    case 'timeout':
      return t.errTimeout;
    case 'auth':
      return t.errAuth;
    case 'rate_limit':
      return t.errRate;
    case 'aborted':
      return t.stopped;
    case 'query':
    case 'unavailable':
      return err.message;
    default:
      return t.errServer;
  }
}
