import type { STRINGS } from '../i18n';
import { ApiError, normalizeBaseUrl } from './api';

type Strings = (typeof STRINGS)['en'];

/** User-facing error text in the interface language; server details are kept where they help. */
export function describeError(err: unknown, t: Strings, baseUrl: string): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : t.errServer;
  switch (err.kind) {
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
