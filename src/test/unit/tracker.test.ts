import { ITrackingHandle, startTracking } from '../../extensions/eulerianTracking/lib/tracker';
import { IFakeContext, MemoryStorage, TEST_EMAIL_SHA256, fakeContext, nodeCrypto, recordingFetch, silentLogger } from './helpers';

const NOW: number = 1767225600000; // 2026-01-01T00:00:00Z
const BASE_CONFIG = { collectorHost: 'collector.example.com', siteName: 'my-site', consentMode: 'pmcat', pmcat: '-' };

function start(
  config: Record<string, unknown>,
  ctx: IFakeContext = fakeContext(),
  storage: MemoryStorage = new MemoryStorage()
): { handle: ITrackingHandle | undefined; rec: ReturnType<typeof recordingFetch>; ctx: IFakeContext } {
  const rec = recordingFetch();
  const handle: ITrackingHandle | undefined = startTracking(config, ctx, {
    fetch: rec.fetch,
    storage,
    crypto: nodeCrypto,
    document,
    now: () => NOW,
    logger: silentLogger
  });
  return { handle, rec, ctx };
}

function hits(rec: ReturnType<typeof recordingFetch>): Record<string, unknown>[] {
  // Every request must carry exactly one hit.
  rec.requests.forEach((r) => expect(r.body.length).toBe(1));
  return rec.requests.map((r) => r.body[0]);
}

// jsdom can't navigate: cancel link default actions (bubble phase, after our
// capture-phase listener has run) to keep the test output clean.
const preventNavigation = (e: Event): void => e.preventDefault();
beforeAll(() => document.addEventListener('click', preventNavigation));
afterAll(() => document.removeEventListener('click', preventNavigation));

describe('startTracking', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('invalid config: one warning, no hit, no listener', () => {
    const warnings: string[] = [];
    const rec = recordingFetch();
    const handle = startTracking({ collectorHost: 'https://bad/' }, fakeContext(), {
      fetch: rec.fetch,
      now: () => NOW,
      logger: { debug: () => undefined, warn: (m: string) => warnings.push(m) }
    });
    expect(handle).toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('collectorHost');
    expect(rec.requests.length).toBe(0);
  });

  it('initial page view: exact hit object', async () => {
    const { handle, rec } = start(BASE_CONFIG);
    await handle!.ready();
    expect(rec.requests[0].url).toBe('https://collector.example.com/collectorjson/my-site/1767225600');
    const [hit] = hits(rec);
    expect(hit).toEqual({
      euidl: expect.stringMatching(/^[0-9a-f-]{36}$/),
      url: 'https://contoso.example.com/sites/hr/SitePages/Home.aspx',
      'ereplay-time': 1767225600,
      path: '/sharepoint|sites/hr|Home',
      pagegroup: 'Human Resources',
      rf: 'https://www.example.org/',
      pmcat: '-'
    });
  });

  it('in-app navigation: one hit per URL, deduplicated, rf = previous URL', async () => {
    const { handle, rec, ctx } = start(BASE_CONFIG);
    const first: string = ctx.url;
    ctx.navigate(first); // navigatedEvent right after init: duplicate
    ctx.navigate('https://contoso.example.com/sites/hr/SitePages/News.aspx');
    ctx.navigate('https://contoso.example.com/sites/hr/SitePages/News.aspx'); // fired twice
    await handle!.ready();
    const all = hits(rec);
    expect(all.length).toBe(2);
    expect(all[1].path).toBe('/sharepoint|sites/hr|News');
    expect(all[1].rf).toBe(first);
    expect(all[0].euidl).toBe(all[1].euidl);
  });

  it('same euidl across page loads (shared localStorage)', async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const a = start(BASE_CONFIG, fakeContext(), storage);
    await a.handle!.ready();
    const b = start(BASE_CONFIG, fakeContext(), storage);
    await b.handle!.ready();
    expect(hits(a.rec)[0].euidl).toBe(hits(b.rec)[0].euidl);
  });

  it.each([
    [{ consentMode: 'pmcat', pmcat: '2-5' }, { pmcat: '2-5' }],
    [{ consentMode: 'consented' }, { enoepm: '1' }],
    [{ consentMode: 'nonconsented' }, { enoepm: '0' }]
  ])('consent %p is on every hit', async (consent: Record<string, string>, expected: Record<string, string>) => {
    const { handle, rec, ctx } = start({ collectorHost: 'collector.example.com', siteName: 'my-site', ...consent });
    ctx.navigate('https://contoso.example.com/_layouts/15/search.aspx/siteall?q=x');
    document.body.innerHTML = '<a id="d" href="/Docs/a.pdf">a</a>';
    document.getElementById('d')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await handle!.ready();
    const all = hits(rec);
    expect(all.length).toBe(3);
    all.forEach((hit) => {
      expect(hit).toMatchObject(expected);
      expect(hit).toHaveProperty('euidl');
      expect(hit).toHaveProperty('url');
      expect(hit).toHaveProperty('ereplay-time');
      if (expected.pmcat) expect(hit).not.toHaveProperty('enoepm');
      else expect(hit).not.toHaveProperty('pmcat');
    });
    handle!.dispose();
  });

  describe('identity flags', () => {
    it.each([
      [false, false],
      [true, false],
      [false, true],
      [true, true]
    ])('setUid=%p setEmailHash=%p', async (setUid: boolean, setEmailHash: boolean) => {
      const { handle, rec } = start({ ...BASE_CONFIG, setUid, setEmailHash });
      await handle!.ready();
      const [hit] = hits(rec);
      if (setUid) expect(hit.uid).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
      else expect(hit).not.toHaveProperty('uid');
      if (setEmailHash) expect(hit.email).toBe(TEST_EMAIL_SHA256);
      else expect(hit).not.toHaveProperty('email');
    });

    it('no uid when the object ID is missing, no email when the email is empty', async () => {
      const { handle, rec } = start(
        { ...BASE_CONFIG, setUid: true, setEmailHash: true },
        fakeContext({ objectId: undefined, email: '' })
      );
      await handle!.ready();
      const [hit] = hits(rec);
      expect(hit).not.toHaveProperty('uid');
      expect(hit).not.toHaveProperty('email');
    });

    it('identity is on download and search hits too', async () => {
      const { handle, rec, ctx } = start({ ...BASE_CONFIG, setUid: true, setEmailHash: true });
      await handle!.ready();
      ctx.navigate('https://contoso.example.com/_layouts/15/search.aspx/siteall?q=leave');
      document.body.innerHTML = '<a id="d" href="/Docs/a.pdf">a</a>';
      document.getElementById('d')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await handle!.ready();
      hits(rec).forEach((hit) => {
        expect(hit.uid).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
        expect(hit.email).toBe(TEST_EMAIL_SHA256);
      });
      handle!.dispose();
    });
  });

  it('search page: EASearch hit replaces the plain page view', async () => {
    const { handle, rec } = start(
      BASE_CONFIG,
      fakeContext({ url: 'https://contoso.example.com/_layouts/15/search.aspx/siteall?q=annual%20leave', siteSegment: '', resultCount: 7 })
    );
    await handle!.ready();
    const [hit] = hits(rec);
    expect(hit).toMatchObject({
      path: '/sharepoint|root|search',
      isearchengine: { name: 'sharepoint_search', results: 7, params: { keyword: 'annual leave' } }
    });
    expect(hit).not.toHaveProperty('ereplay-notag');
  });

  it('trackSearch=false: search page is a plain page view', async () => {
    const { handle, rec } = start(
      { ...BASE_CONFIG, trackSearch: false },
      fakeContext({ url: 'https://contoso.example.com/_layouts/15/search.aspx?q=x' })
    );
    await handle!.ready();
    expect(hits(rec)[0]).not.toHaveProperty('isearchengine');
  });

  it('download: standalone hit with the download action, sent synchronously once identity is ready', async () => {
    const { handle, rec, ctx } = start(BASE_CONFIG);
    await handle!.ready();
    document.body.innerHTML = '<a id="d" href="/sites/hr/Shared%20Documents/Q3%20Report.pdf">Q3</a>';
    document.getElementById('d')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    // No await: the fetch must already have been issued inside the click handler.
    expect(rec.requests.length).toBe(2);
    const download = hits(rec)[1];
    expect(download).toMatchObject({
      'ereplay-notag': 1,
      url: ctx.url,
      rf: ctx.url,
      actions: [{ name: 'download', label: 'Q3 Report.pdf', params: { ext: 'pdf' } }],
      pmcat: '-'
    });
    handle!.dispose();
  });

  it('trackDownloads=false installs no listener', async () => {
    const { handle, rec } = start({ ...BASE_CONFIG, trackDownloads: false });
    await handle!.ready();
    document.body.innerHTML = '<a id="d" href="/Docs/a.pdf">a</a>';
    document.getElementById('d')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await handle!.ready();
    expect(rec.requests.length).toBe(1);
  });

  it('never throws when the SharePoint context throws', async () => {
    const ctx: IFakeContext = fakeContext();
    ctx.getSiteTitle = () => {
      throw new Error('boom');
    };
    ctx.getSiteUrlSegment = () => {
      throw new Error('boom');
    };
    const { handle, rec } = start(BASE_CONFIG, ctx);
    await handle!.ready();
    expect(hits(rec)[0].path).toBe('/sharepoint|root|Home');
  });

  it('never throws when getUrl throws', () => {
    const ctx: IFakeContext = fakeContext();
    ctx.getUrl = () => {
      throw new Error('boom');
    };
    expect(() => start(BASE_CONFIG, ctx)).not.toThrow();
  });
});
