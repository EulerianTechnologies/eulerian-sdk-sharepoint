/**
 * In-app navigation bookkeeping.
 *
 * SPFx's navigatedEvent can fire several times for one navigation (and once
 * more right after onInit), so we only track a URL when it differs from the
 * last tracked one. The key is path + query: the #hash is ignored because
 * SharePoint uses it for in-page state that is not a new page.
 *
 * Referrer: the first page view uses document.referrer; later in-app views use
 * the previously tracked URL (document.referrer stays frozen at the first load
 * in a single-page app).
 */

export interface IPageVisit {
  url: string;
  referrer: string | undefined;
}

export function navigationKey(url: string): string {
  const hashIndex: number = url.indexOf('#');
  return hashIndex === -1 ? url : url.substring(0, hashIndex);
}

export class NavigationTracker {
  private lastKey: string | undefined;
  private lastUrl: string | undefined;
  private readonly initialReferrer: string | undefined;

  public constructor(initialReferrer: string | undefined) {
    this.initialReferrer = initialReferrer ? initialReferrer : undefined;
  }

  /** Returns the visit to track, or undefined when it's a duplicate event. */
  public next(url: string): IPageVisit | undefined {
    const key: string = navigationKey(url);
    if (key === this.lastKey) return undefined;
    const referrer: string | undefined = this.lastUrl === undefined ? this.initialReferrer : this.lastUrl;
    this.lastKey = key;
    this.lastUrl = url;
    return { url, referrer };
  }
}
