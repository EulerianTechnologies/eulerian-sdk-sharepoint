/**
 * The only SharePoint knowledge the tracker needs, behind a small interface.
 * The customizer implements it with SPFx's PageContext; the harness implements
 * it with plain browser APIs. Keeping lib/ free of SPFx imports is what lets
 * the exact same tracking code run in unit tests and in the local harness.
 */
export interface ITrackingContext {
  /** Full current URL (location.href). */
  getUrl(): string;
  /** Web server-relative URL without the leading slash, e.g. "sites/hr"; "" for the root site. */
  getSiteUrlSegment(): string;
  /** Current web (site) title, used as pagegroup. */
  getSiteTitle(): string;
  /** Microsoft Entra ID object ID of the current user, if known. */
  getEntraObjectId(): string | undefined;
  /** Current user's email, if known. */
  getEmail(): string | undefined;
  /** document.referrer at the initial page load. */
  getInitialReferrer(): string;
  /** Number of search results if the page exposes it reliably, else undefined. */
  getSearchResultCount(): number | undefined;
  /** Registers a callback fired on in-app navigation (may fire several times per navigation). */
  onNavigate(callback: () => void): void;
}

/** Minimal logger: everything goes through it so `debug: false` stays silent. */
export interface ILogger {
  debug(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
}

const PREFIX: string = '[Eulerian]';

export function createConsoleLogger(debugEnabled: boolean): ILogger {
  return {
    debug(message: string, data?: unknown): void {
      if (!debugEnabled || typeof console === 'undefined') return;
      if (data === undefined) console.log(PREFIX, message);
      else console.log(PREFIX, message, data);
    },
    warn(message: string, data?: unknown): void {
      if (typeof console === 'undefined') return;
      if (data === undefined) console.warn(PREFIX, message);
      else console.warn(PREFIX, message, data);
    }
  };
}
