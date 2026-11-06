import {
  ITransport,
  buildRequestInit,
  collectorBaseUrl,
  collectorUrl,
  createTransport
} from '../../extensions/eulerianTracking/lib/transport';
import { recordingFetch, silentLogger } from './helpers';

describe('transport', () => {
  it('URL format: https://<host>/collectorjson/<siteName>/<unix seconds>', () => {
    expect(collectorUrl(collectorBaseUrl('collector.example.com'), 'my-site', 1767225600999)).toBe(
      'https://collector.example.com/collectorjson/my-site/1767225600'
    );
  });

  it('URL-encodes the site name defensively', () => {
    expect(collectorUrl('https://h.example.com', 'a b', 0)).toBe('https://h.example.com/collectorjson/a%20b/0');
  });

  it('request: JSON POST, keepalive, cors, no credentials, one-element array body', () => {
    const init: RequestInit = buildRequestInit({ euidl: 'x', url: 'u' });
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.keepalive).toBe(true);
    expect(init.mode).toBe('cors');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual([{ euidl: 'x', url: 'u' }]);
  });

  it('send() posts one hit per request', async () => {
    const rec = recordingFetch();
    const transport: ITransport = createTransport('https://collector.example.com', 'my-site', rec.fetch, () => 1767225600000, silentLogger);
    await transport.send({ a: 1 });
    await transport.send({ b: 2 });
    expect(rec.requests.map((r) => r.url)).toEqual([
      'https://collector.example.com/collectorjson/my-site/1767225600',
      'https://collector.example.com/collectorjson/my-site/1767225600'
    ]);
    expect(rec.requests.map((r) => r.body)).toEqual([[{ a: 1 }], [{ b: 2 }]]);
  });

  it('never rejects on network error, synchronous throw or missing fetch', async () => {
    const rejecting = createTransport('https://h.example.com', 'my-site', () => Promise.reject(new TypeError('Failed to fetch')), Date.now, silentLogger);
    await expect(rejecting.send({})).resolves.toBeUndefined();

    const throwing = createTransport(
      'https://h.example.com',
      'my-site',
      () => {
        throw new Error('sync');
      },
      Date.now,
      silentLogger
    );
    await expect(throwing.send({})).resolves.toBeUndefined();

    const noFetch = createTransport('https://h.example.com', 'my-site', undefined, Date.now, silentLogger);
    await expect(noFetch.send({})).resolves.toBeUndefined();
  });

  it('logs payload and HTTP status in debug', async () => {
    const lines: string[] = [];
    const logger = { debug: (m: string) => lines.push(m), warn: () => undefined };
    await createTransport('https://h.example.com', 'my-site', recordingFetch(204).fetch, () => 0, logger).send({});
    expect(lines).toEqual(['POST https://h.example.com/collectorjson/my-site/0', 'collector answered HTTP 204']);
  });
});
