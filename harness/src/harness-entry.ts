/**
 * Harness entry point: runs the SAME lib/ tracking code as the SPFx
 * customizer, with an ITrackingContext built from plain browser APIs instead
 * of SPFx's PageContext. Compiled by harness/tsconfig.json to ES modules.
 */
import { ITrackingContext } from '../../src/extensions/eulerianTracking/lib/context';
import { ICryptoLike, IStorageLike } from '../../src/extensions/eulerianTracking/lib/identity';
import { ITrackingHandle, startTracking } from '../../src/extensions/eulerianTracking/lib/tracker';
import { FetchLike } from '../../src/extensions/eulerianTracking/lib/transport';

function meta(name: string): string {
  const el: HTMLMetaElement | null = document.querySelector('meta[name="' + name + '"]');
  return el ? el.content : '';
}

function siteSegment(pathname: string): string {
  const m: RegExpExecArray | null = /^\/(sites|teams)\/([^/]+)/i.exec(pathname);
  return m ? m[1] + '/' + m[2] : '';
}

const context: ITrackingContext = {
  getUrl: () => window.location.href,
  getSiteUrlSegment: () => siteSegment(window.location.pathname),
  getSiteTitle: () => document.body.getAttribute('data-site-title') || '',
  getEntraObjectId: () => meta('harness-user-id') || undefined,
  getEmail: () => meta('harness-user-email') || undefined,
  getInitialReferrer: () => document.referrer,
  getSearchResultCount: () => undefined,
  onNavigate: (callback: () => void) => {
    document.addEventListener('harness:navigated', callback);
  }
};

function localStorageOrUndefined(): IStorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function start(): void {
  let config: unknown;
  try {
    config = JSON.parse(meta('eulerian-config'));
  } catch {
    config = undefined; // startTracking warns about it
  }
  const handle: ITrackingHandle | undefined = startTracking(config, context, {
    fetch: window.fetch.bind(window) as FetchLike,
    storage: localStorageOrUndefined(),
    crypto: window.crypto as unknown as ICryptoLike,
    document,
    now: () => Date.now(),
    // Empty in real-collector mode: then the tracker posts to https://<collectorHost>.
    collectorBaseUrlOverride: meta('harness-collector-base') || undefined
  });
  // Exposed for manual poking in the devtools console only.
  (window as unknown as { eulerianHarness?: ITrackingHandle }).eulerianHarness = handle;
}

// Module scripts are deferred: by now the DOM is parsed and app.js (listed
// first in the page) has rendered the site title.
start();
