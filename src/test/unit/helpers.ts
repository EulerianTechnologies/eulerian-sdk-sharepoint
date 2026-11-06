/// <reference types="node" />
import { webcrypto } from 'crypto';

import { ILogger, ITrackingContext } from '../../extensions/eulerianTracking/lib/context';
import { ICryptoLike, IStorageLike } from '../../extensions/eulerianTracking/lib/identity';

/**
 * Node's WebCrypto, adapted for Jest's jsdom realm: jsdom typed arrays come
 * from another realm, so copy them into a Node Buffer before digesting.
 */
export const nodeCrypto: ICryptoLike = {
  randomUUID: () => webcrypto.randomUUID(),
  subtle: {
    digest: (algorithm: string, data: ArrayBuffer | Uint8Array) =>
      webcrypto.subtle.digest(algorithm, Buffer.from(data as Uint8Array))
  }
};

export class MemoryStorage implements IStorageLike {
  public readonly data: Record<string, string> = {};
  // eslint-disable-next-line @rushstack/no-new-null -- mirrors DOM Storage
  public getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
  }
  public setItem(key: string, value: string): void {
    this.data[key] = value;
  }
}

export const silentLogger: ILogger = {
  debug: () => undefined,
  warn: () => undefined
};

export interface IFakeContext extends ITrackingContext {
  url: string;
  siteSegment: string;
  siteTitle: string;
  objectId: string | undefined;
  email: string | undefined;
  referrer: string;
  resultCount: number | undefined;
  navigate(url: string): void;
}

/** Mutable ITrackingContext; navigate() changes the URL and fires the listeners. */
export function fakeContext(overrides: Partial<IFakeContext> = {}): IFakeContext {
  const listeners: Array<() => void> = [];
  const ctx: IFakeContext = {
    url: 'https://contoso.example.com/sites/hr/SitePages/Home.aspx',
    siteSegment: 'sites/hr',
    siteTitle: 'Human Resources',
    objectId: 'A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF',
    email: ' Test@Example.com ',
    referrer: 'https://www.example.org/',
    resultCount: undefined,
    getUrl: () => ctx.url,
    getSiteUrlSegment: () => ctx.siteSegment,
    getSiteTitle: () => ctx.siteTitle,
    getEntraObjectId: () => ctx.objectId,
    getEmail: () => ctx.email,
    getInitialReferrer: () => ctx.referrer,
    getSearchResultCount: () => ctx.resultCount,
    onNavigate: (cb: () => void) => {
      listeners.push(cb);
    },
    navigate: (url: string) => {
      ctx.url = url;
      listeners.forEach((cb: () => void) => cb());
    },
    ...overrides
  };
  return ctx;
}

export interface IRecordedRequest {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>[];
}

/** Fake fetch recording every request. */
export function recordingFetch(status: number = 200): {
  fetch: (url: string, init: RequestInit) => Promise<{ status: number }>;
  requests: IRecordedRequest[];
} {
  const requests: IRecordedRequest[] = [];
  return {
    requests,
    fetch: (url: string, init: RequestInit) => {
      requests.push({ url, init, body: JSON.parse(init.body as string) });
      return Promise.resolve({ status });
    }
  };
}

/** SHA-256("test@example.com"), computed with: printf '%s' test@example.com | sha256sum */
export const TEST_EMAIL_SHA256: string = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';
