import { ITrackingConfig, readConfig, ConfigResult } from './config';
import { consentFields } from './consent';
import { ILogger, ITrackingContext, createConsoleLogger } from './context';
import { IDownloadInfo, IListenerTarget, installDownloadListener } from './downloads';
import { ICryptoLike, IIdentity, IStorageLike, resolveIdentity } from './identity';
import { IPageVisit, NavigationTracker } from './navigation';
import { SEARCH_ENGINE_NAME, buildPagePath, searchKeyword } from './page';
import { ActionBuilder } from './tags/action';
import { EaGenericBuilder, Hit, IHitInternals } from './tags/ea-generic';
import { EASearchBuilder } from './tags/ea-search';
import { ParamsBuilder } from './tags/params';
import { FetchLike, ITransport, collectorBaseUrl, createTransport } from './transport';

/**
 * Wires everything together. Used by the SPFx customizer AND by the harness,
 * so both run exactly the same tracking logic.
 */

/** Browser capabilities, injected so tests and the harness can substitute them. */
export interface ITrackingEnvironment {
  fetch?: FetchLike;
  storage?: IStorageLike;
  crypto?: ICryptoLike;
  /** Where the download listener is installed (normally `document`). */
  document?: IListenerTarget;
  now: () => number;
  /** Defaults to a console logger honouring `debug`. */
  logger?: ILogger;
  /**
   * Harness/test only: overrides "https://<collectorHost>". Never read from
   * ComponentProperties, so admins can't point it at plain http.
   */
  collectorBaseUrlOverride?: string;
}

export interface ITrackingHandle {
  readonly config: ITrackingConfig;
  /** Tracks the current URL as a page view (deduplicated). */
  trackCurrentPage(): void;
  /** Resolves once identity is ready and every hit queued so far was handed to fetch. */
  ready(): Promise<void>;
  dispose(): void;
}

/**
 * THE central function: applies identity, referrer and consent to any builder
 * right before build(), so no tag type can forget them.
 */
export function finalizeHit(
  builder: EaGenericBuilder,
  config: Pick<ITrackingConfig, 'setUid' | 'setEmailHash' | 'consentMode' | 'pmcat'>,
  identity: IIdentity,
  referrer: string | undefined
): Hit {
  if (config.setUid) builder.setUid(identity.uid);
  if (config.setEmailHash) builder.setEmailHash(identity.emailHash);
  builder.setReferrer(referrer);
  const consent: Record<string, string> = consentFields(config);
  for (const key of Object.keys(consent)) builder.set(key, consent[key]);
  return builder.build();
}

/** Builds the hit for a page view: EASearch on search pages, EaGeneric otherwise. */
export function buildPageViewHit(
  config: ITrackingConfig,
  internals: IHitInternals,
  siteSegment: string,
  siteTitle: string,
  identity: IIdentity,
  visit: IPageVisit,
  searchResultCount: number | undefined
): Hit {
  const path: string = buildPagePath(config.pathPrefix, siteSegment, visit.url);
  const keyword: string | undefined = config.trackSearch ? searchKeyword(visit.url) : undefined;

  let builder: EaGenericBuilder;
  if (keyword !== undefined) {
    const search: EASearchBuilder = new EASearchBuilder(internals, path)
      .setName(SEARCH_ENGINE_NAME)
      .setParams(new ParamsBuilder().addParam('keyword', keyword).build());
    if (typeof searchResultCount === 'number' && searchResultCount >= 0) search.setResults(searchResultCount);
    builder = search;
  } else {
    builder = new EaGenericBuilder(internals, path);
  }
  builder.setPageGroup(siteTitle);
  return finalizeHit(builder, config, identity, visit.referrer);
}

/** Builds the event-only hit for a document download/open. */
export function buildDownloadHit(
  config: ITrackingConfig,
  internals: IHitInternals,
  siteSegment: string,
  siteTitle: string,
  identity: IIdentity,
  download: IDownloadInfo,
  referrer: string | undefined
): Hit {
  const action = new ActionBuilder()
    .setName('download')
    .setLabel(download.fileName)
    .setParams(new ParamsBuilder().addParam('ext', download.ext).build())
    .build();
  const builder: EaGenericBuilder = new EaGenericBuilder(internals, buildPagePath(config.pathPrefix, siteSegment, internals.url))
    .setStandalone()
    .setPageGroup(siteTitle)
    .putAction(action);
  return finalizeHit(builder, config, identity, referrer);
}

/** Starts tracking. Returns undefined (after one console warning) if the config is invalid. */
export function startTracking(
  rawConfig: unknown,
  context: ITrackingContext,
  env: ITrackingEnvironment
): ITrackingHandle | undefined {
  const result: ConfigResult = readConfig(rawConfig);
  if (!result.ok) {
    (env.logger || createConsoleLogger(false)).warn('tracking disabled: ' + result.error);
    return undefined;
  }
  const config: ITrackingConfig = result.config;
  const logger: ILogger = env.logger || createConsoleLogger(config.debug);
  const transport: ITransport = createTransport(
    env.collectorBaseUrlOverride || collectorBaseUrl(config.collectorHost),
    config.siteName,
    env.fetch,
    env.now,
    logger
  );
  const navigation: NavigationTracker = new NavigationTracker(safeCall(() => context.getInitialReferrer(), ''));

  // In-flight work, so ready() can wait for it. Entries remove themselves when
  // settled, so a long-lived SharePoint tab doesn't accumulate promises.
  const pending: Set<Promise<void>> = new Set<Promise<void>>();
  const track = (promise: Promise<void>): void => {
    pending.add(promise);
    const remove = (): void => {
      pending.delete(promise);
    };
    promise.then(remove, remove);
  };

  // Identity is resolved once per page load (email hashing is async).
  let identity: IIdentity | undefined;
  const identityPromise: Promise<IIdentity> = resolveIdentity(
    config,
    context,
    env.storage,
    env.crypto,
    (message: string, error: unknown) => logger.debug(message, error)
  ).then((resolved: IIdentity) => {
    identity = resolved;
    return resolved;
  });

  // Runs `fn` synchronously when identity is already known. This matters for
  // download clicks: the fetch must start before the browser leaves the page.
  const withIdentity = (fn: (id: IIdentity) => void): void => {
    const run = (id: IIdentity): void => {
      try {
        fn(id);
      } catch (error) {
        logger.debug('tracking error', error);
      }
    };
    if (identity) run(identity);
    else track(identityPromise.then(run, (error: unknown) => logger.debug('identity error', error)));
  };

  const internalsFor = (id: IIdentity, url: string): IHitInternals => ({
    euidl: id.euidl,
    url,
    time: Math.floor(env.now() / 1000)
  });

  const send = (hit: Hit): void => {
    track(transport.send(hit));
  };

  const trackCurrentPage = (): void => {
    try {
      const visit: IPageVisit | undefined = navigation.next(context.getUrl());
      if (!visit) return;
      // Read SharePoint context now (at navigation time), not later.
      const siteSegment: string = safeCall(() => context.getSiteUrlSegment(), '');
      const siteTitle: string = safeCall(() => context.getSiteTitle(), '');
      withIdentity((id: IIdentity) => {
        const count: number | undefined = safeCall(() => context.getSearchResultCount(), undefined);
        send(buildPageViewHit(config, internalsFor(id, visit.url), siteSegment, siteTitle, id, visit, count));
      });
    } catch (error) {
      logger.debug('page view not tracked', error);
    }
  };

  let removeDownloadListener: (() => void) | undefined;
  if (config.trackDownloads && env.document) {
    removeDownloadListener = installDownloadListener(
      env.document,
      () => context.getUrl(),
      (download: IDownloadInfo) => {
        const url: string = context.getUrl();
        const siteSegment: string = safeCall(() => context.getSiteUrlSegment(), '');
        const siteTitle: string = safeCall(() => context.getSiteTitle(), '');
        withIdentity((id: IIdentity) => {
          // rf of a download = the page where the link was clicked.
          send(buildDownloadHit(config, internalsFor(id, url), siteSegment, siteTitle, id, download, url));
        });
      },
      (error: unknown) => logger.debug('download tracking error', error)
    );
  }

  safeCall(() => context.onNavigate(trackCurrentPage), undefined);
  trackCurrentPage();
  logger.debug('tracking started', config);

  return {
    config,
    trackCurrentPage,
    ready(): Promise<void> {
      // Wait for identity, then for everything queued so far (sends included).
      return identityPromise.then(
        () => {
          const snapshot: Promise<void>[] = [];
          pending.forEach((p: Promise<void>) => snapshot.push(p));
          return Promise.all(snapshot).then(() => undefined);
        },
        () => undefined
      );
    },
    dispose(): void {
      if (removeDownloadListener) removeDownloadListener();
      removeDownloadListener = undefined;
    }
  };
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    const value: T = fn();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}
