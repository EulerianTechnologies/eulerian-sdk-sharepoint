import { BaseApplicationCustomizer } from '@microsoft/sp-application-base';

import { ITrackingContext } from './lib/context';
import { ICryptoLike, IStorageLike } from './lib/identity';
import { ITrackingHandle, startTracking } from './lib/tracker';
import { FetchLike } from './lib/transport';

/**
 * ComponentProperties as set by the tenant admin (Tenant Wide Extensions
 * list). Validated in lib/config.ts; every field is optional here because the
 * admin may type anything.
 */
export interface IEulerianTrackingApplicationCustomizerProperties {
  collectorHost?: string;
  siteName?: string;
  consentMode?: string;
  pmcat?: string;
  setUid?: boolean | string;
  setEmailHash?: boolean | string;
  trackDownloads?: boolean | string;
  trackSearch?: boolean | string;
  pathPrefix?: string;
  debug?: boolean | string;
}

/**
 * Thin SPFx glue: adapts PageContext to ITrackingContext and hands over to
 * lib/tracker.ts. All tracking logic lives in lib/ (shared with the harness).
 */
export default class EulerianTrackingApplicationCustomizer extends BaseApplicationCustomizer<IEulerianTrackingApplicationCustomizerProperties> {
  private handle: ITrackingHandle | undefined;

  public onInit(): Promise<void> {
    // Tracking must never break a SharePoint page: swallow everything.
    try {
      this.handle = startTracking(this.properties, this.createContext(), {
        fetch: typeof fetch === 'function' ? (fetch.bind(window) as FetchLike) : undefined,
        storage: getLocalStorage(),
        crypto: typeof window !== 'undefined' ? (window.crypto as unknown as ICryptoLike) : undefined,
        document: typeof document !== 'undefined' ? document : undefined,
        now: () => Date.now()
      });
    } catch {
      /* nothing: never throw from onInit */
    }
    return Promise.resolve();
  }

  public onDispose(): void {
    try {
      if (this.handle) this.handle.dispose();
    } catch {
      /* ignore */
    }
    super.onDispose();
  }

  private createContext(): ITrackingContext {
    // Note: SPFx updates this.context.pageContext in place on in-app
    // navigation, so read it lazily on each call rather than caching values.
    return {
      getUrl: () => window.location.href,
      getSiteUrlSegment: () => this.context.pageContext.web.serverRelativeUrl,
      getSiteTitle: () => this.context.pageContext.web.title,
      getEntraObjectId: () => {
        const aad = this.context.pageContext.aadInfo;
        return aad && aad.userId ? aad.userId.toString() : undefined;
      },
      getEmail: () => this.context.pageContext.user.email,
      getInitialReferrer: () => document.referrer,
      // Microsoft Search renders its result count asynchronously and without a
      // stable selector: not reliably readable, so isearchresults is omitted.
      getSearchResultCount: () => undefined,
      onNavigate: (callback: () => void) => {
        // Fires on every in-app (SPA) navigation, sometimes several times;
        // NavigationTracker deduplicates.
        this.context.application.navigatedEvent.add(this, callback);
      }
    };
  }
}

/** localStorage can throw on access (blocked storage): treat as unavailable. */
function getLocalStorage(): IStorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
