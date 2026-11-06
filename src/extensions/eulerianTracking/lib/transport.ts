import { ILogger } from './context';
import { Hit } from './tags/ea-generic';

/**
 * JSON POST to collectorjson, as in eanalytics-react-native
 * src/utils/httpHelper.ts:
 *   POST https://<collectorHost>/collectorjson/<siteName>/<unix seconds>
 * The SDKs put "-" where we put the Eulerian site name: here the site is
 * always explicit (mandatory `siteName` setting).
 *   Content-Type: application/json
 *   body: [ <hit> ]      (one hit per request: no offline queue in v1)
 *
 * Not sendBeacon: browsers refuse/restrict beacons with an application/json
 * body. keepalive lets the request outlive the page (download clicks).
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<{ status: number }>;

export interface ITransport {
  /** Fire-and-forget. The returned promise always resolves (never rejects). */
  send(hit: Hit): Promise<void>;
}

/** e.g. collectorBaseUrl("collector.example.com") -> "https://collector.example.com" */
export function collectorBaseUrl(collectorHost: string): string {
  return 'https://' + collectorHost;
}

export function collectorUrl(baseUrl: string, siteName: string, nowMs: number): string {
  // Trailing epoch seconds act as a cache buster, exactly like the SDKs.
  return baseUrl + '/collectorjson/' + encodeURIComponent(siteName) + '/' + Math.floor(nowMs / 1000);
}

export function buildRequestInit(hit: Hit): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([hit]),
    keepalive: true,
    mode: 'cors',
    credentials: 'omit'
  };
}

export function createTransport(
  baseUrl: string,
  siteName: string,
  fetchFn: FetchLike | undefined,
  now: () => number,
  logger: ILogger
): ITransport {
  return {
    send(hit: Hit): Promise<void> {
      try {
        if (!fetchFn) {
          logger.debug('fetch() is not available, hit dropped', hit);
          return Promise.resolve();
        }
        const url: string = collectorUrl(baseUrl, siteName, now());
        logger.debug('POST ' + url, hit);
        return fetchFn(url, buildRequestInit(hit)).then(
          (response: { status: number }) => {
            logger.debug('collector answered HTTP ' + response.status);
          },
          (error: unknown) => {
            // Network error, CORS refusal or CSP connect-src block all land here.
            logger.debug('hit not delivered (network, CORS or CSP error)', error);
          }
        );
      } catch (error) {
        logger.debug('hit not delivered', error);
        return Promise.resolve();
      }
    }
  };
}
