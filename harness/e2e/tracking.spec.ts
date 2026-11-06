import { APIRequestContext, ConsoleMessage, Page, expect, test } from '@playwright/test';
import { createHash } from 'crypto';

const COLLECTOR: string = 'http://127.0.0.1:8402';
const PAGE_ORIGIN: string = 'http://127.0.0.1:8401';
const HOME: string = '/sites/hr/SitePages/Home.aspx';

interface IStoredHit {
  epoch: string;
  content_type: string;
  origin: string;
  hit: Record<string, unknown>;
}
interface ICollectorState {
  hits: IStoredHit[];
  rejected: unknown[];
  preflights: number;
  cors: boolean;
}

async function collector(request: APIRequestContext): Promise<ICollectorState> {
  return (await request.get(COLLECTOR + '/hits')).json();
}

async function hits(request: APIRequestContext): Promise<Record<string, unknown>[]> {
  return (await collector(request)).hits.map((h) => h.hit);
}

/** Polls the fake collector until `count` hits arrived, then waits a bit more to catch extras. */
async function waitForHits(request: APIRequestContext, count: number): Promise<Record<string, unknown>[]> {
  await expect.poll(async () => (await hits(request)).length, { timeout: 10000 }).toBeGreaterThanOrEqual(count);
  await new Promise((r) => setTimeout(r, 500));
  return hits(request);
}

/** Page URL with ComponentProperties overrides (harness.pl reads ?config=<base64 JSON>). */
function withConfig(path: string, config: Record<string, unknown>): string {
  return path + '?config=' + encodeURIComponent(Buffer.from(JSON.stringify(config)).toString('base64'));
}

/** Collects CSP violations and uncaught page errors. */
function watchPage(page: Page): { csp: string[]; errors: string[]; console: string[] } {
  const out = { csp: [] as string[], errors: [] as string[], console: [] as string[] };
  page.on('console', (msg: ConsoleMessage) => {
    const text: string = msg.text();
    out.console.push(msg.type() + ': ' + text);
    if (/content.security.policy|refused to (load|execute|connect)/i.test(text)) out.csp.push(text);
  });
  page.on('pageerror', (err: Error) => out.errors.push(err.message));
  return out;
}

test.beforeEach(async ({ request }) => {
  await request.post(COLLECTOR + '/control', { data: { cors: 1 } });
  await request.post(COLLECTOR + '/hits/reset');
});

test('page view on load + one pushState navigation: mandatory fields, preflight, no CSP errors', async ({ page, request }) => {
  const watch = watchPage(page);
  await page.goto(HOME);
  await waitForHits(request, 1);

  // app.js fires "harness:navigated" twice: the tracker must deduplicate.
  await page.click('text=HR news');
  const all = await waitForHits(request, 2);
  expect(all.length).toBe(2);

  const state: ICollectorState = await collector(request);
  expect(state.rejected).toEqual([]);
  expect(state.preflights).toBeGreaterThan(0);
  for (const stored of state.hits) {
    expect(stored.content_type).toMatch(/^application\/json/);
    expect(stored.origin).toBe(PAGE_ORIGIN);
    expect(stored.epoch).toMatch(/^\d+$/);
  }

  const [first, second] = all;
  for (const hit of all) {
    expect(hit.euidl).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof hit['ereplay-time']).toBe('number');
    expect(hit.pmcat).toBe('-');
  }
  expect(first).toMatchObject({ url: PAGE_ORIGIN + HOME, path: '/sharepoint|sites/hr|Home', pagegroup: 'Site HR' });
  expect(first).not.toHaveProperty('rf'); // direct load: empty document.referrer
  expect(second).toMatchObject({
    url: PAGE_ORIGIN + '/sites/hr/SitePages/News.aspx',
    path: '/sharepoint|sites/hr|News',
    rf: PAGE_ORIGIN + HOME
  });
  expect(second.euidl).toBe(first.euidl);
  // No identity unless the admin enabled it.
  for (const hit of all) {
    expect(hit).not.toHaveProperty('uid');
    expect(hit).not.toHaveProperty('email');
  }

  expect(watch.csp).toEqual([]);
  expect(watch.errors).toEqual([]);
});

test('same euidl across reloads (localStorage "eulerian-euidl")', async ({ page, request }) => {
  await page.goto(HOME);
  await waitForHits(request, 1);
  await page.reload();
  const all = await waitForHits(request, 2);
  expect(all.length).toBe(2);
  expect(all[1].euidl).toBe(all[0].euidl);
  expect(await page.evaluate(() => localStorage.getItem('eulerian-euidl'))).toBe(all[0].euidl);
});

test('cross-site navigation and back button', async ({ page, request }) => {
  await page.goto(HOME);
  await page.click('text=IT home');
  await page.goBack();
  const all = await waitForHits(request, 3);
  expect(all.map((h) => h.path)).toEqual(['/sharepoint|sites/hr|Home', '/sharepoint|sites/it|Home', '/sharepoint|sites/hr|Home']);
  expect(all[1].pagegroup).toBe('Site IT');
});

test('internal search: EASearch hit', async ({ page, request }) => {
  await page.goto(HOME);
  await waitForHits(request, 1);
  await page.fill('#q', 'annual leave');
  await page.click('button[type=submit]');
  const all = await waitForHits(request, 2);
  expect(all[1]).toMatchObject({
    path: '/sharepoint|root|search',
    isearchengine: 'sharepoint_search',
    isearchparams: { keyword: 'annual leave' },
    rf: PAGE_ORIGIN + HOME
  });
  expect(all[1]).not.toHaveProperty('isearchresults');
});

test('download that navigates the tab away still arrives (keepalive)', async ({ page, request }) => {
  const watch = watchPage(page);
  await page.goto(HOME);
  await waitForHits(request, 1);
  // The PDF replaces the page (or becomes a download in headless browsers).
  await page.click('#dl-same-tab').catch(() => undefined);
  const all = await waitForHits(request, 2);
  const download = all.find((h) => h['ereplay-notag'] === 1);
  expect(download).toMatchObject({
    'ereplay-notag': 1,
    url: PAGE_ORIGIN + HOME,
    rf: PAGE_ORIGIN + HOME,
    path: '/sharepoint|sites/hr|Home',
    pmcat: '-',
    actions: [{ name: 'download', label: 'report.pdf', params: { ext: 'pdf' } }]
  });
  expect(watch.csp).toEqual([]);
});

test('download in a new tab and Office for the web link', async ({ page, request, context }) => {
  await page.goto(HOME);
  await waitForHits(request, 1);
  const popup = context.waitForEvent('page').catch(() => undefined);
  await page.click('#dl-new-tab');
  await popup;
  await page.click('#dl-office');
  const all = await waitForHits(request, 3);
  const labels = all.filter((h) => h['ereplay-notag'] === 1).map((h) => (h.actions as Array<{ label: string }>)[0].label);
  expect(labels.sort()).toEqual(['Minutes.docx', 'budget.xlsx']);
});

test('page links are not downloads', async ({ page, request }) => {
  await page.goto(HOME);
  await page.click('#not-a-doc');
  const all = await waitForHits(request, 2);
  expect(all.filter((h) => h['ereplay-notag'] === 1)).toEqual([]);
});

test('identity flags: uid (lowercase Entra ID) and hashed email on every hit', async ({ page, request }) => {
  const config = { setUid: true, setEmailHash: true, consentMode: 'consented' };
  await page.goto(withConfig(HOME, config));
  await waitForHits(request, 1);
  await page.click('#dl-office');
  const all = await waitForHits(request, 2);
  const expectedHash: string = createHash('sha256').update('test@example.com').digest('hex');
  for (const hit of all) {
    expect(hit.uid).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
    expect(hit.email).toBe(expectedHash);
    expect(hit.enoepm).toBe('1');
    expect(hit).not.toHaveProperty('pmcat');
  }
});

test('nonconsented mode sends enoepm=0', async ({ page, request }) => {
  await page.goto(withConfig(HOME, { consentMode: 'nonconsented' }));
  const [hit] = await waitForHits(request, 1);
  expect(hit.enoepm).toBe('0');
});

test('invalid config: one console warning and no request', async ({ page, request }) => {
  const watch = watchPage(page);
  await page.goto(withConfig(HOME, { collectorHost: 'https://collector.example.com/' }));
  await page.click('text=HR news');
  await new Promise((r) => setTimeout(r, 1000));
  const state: ICollectorState = await collector(request);
  expect(state.hits).toEqual([]);
  expect(state.preflights).toBe(0);
  expect(watch.console.filter((l) => l.indexOf('[Eulerian] tracking disabled') !== -1).length).toBe(1);
  expect(watch.errors).toEqual([]);
});

test('collector without CORS headers: hits are blocked, page keeps working', async ({ page, request }) => {
  await request.post(COLLECTOR + '/control', { data: { cors: 0 } });
  const watch = watchPage(page);
  await page.goto(HOME);
  await page.click('text=HR news');
  await expect(page.locator('#page-name')).toHaveText('/sites/hr/SitePages/News.aspx');
  await new Promise((r) => setTimeout(r, 1000));
  const state: ICollectorState = await collector(request);
  expect(state.preflights).toBeGreaterThan(0); // the browser asked...
  expect(state.hits).toEqual([]); // ...and, refused, never sent the POST
  expect(watch.errors).toEqual([]);
});
