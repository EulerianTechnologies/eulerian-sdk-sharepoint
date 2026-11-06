import { IDownloadInfo, detectDownload, installDownloadListener } from '../../extensions/eulerianTracking/lib/downloads';

const BASE: string = 'https://contoso.example.com/sites/hr/SitePages/Home.aspx';

describe('detectDownload', () => {
  it.each([
    ['/sites/hr/Shared%20Documents/Q3%20Report.pdf', 'Q3 Report.pdf', 'pdf'],
    ['https://contoso.example.com/sites/hr/Docs/plan.DOCX', 'plan.DOCX', 'docx'],
    ['Docs/budget.xlsx?web=1', 'budget.xlsx', 'xlsx'],
    ['/sites/hr/Docs/deck.pptx#slide=2', 'deck.pptx', 'pptx'],
    ['/_layouts/15/Doc.aspx?sourcedoc=%7Babc%7D&file=Minutes.docx&action=default', 'Minutes.docx', 'docx'],
    ['/_layouts/15/download.aspx?SourceUrl=%2Fsites%2Fhr%2FDocs%2Fdata.csv', 'data.csv', 'csv'],
    ['/sites/hr/Docs/Forms/AllItems.aspx?id=%2Fsites%2Fhr%2FDocs%2Fpolicy.pdf&parent=%2Fsites%2Fhr%2FDocs', 'policy.pdf', 'pdf'],
    ['/sites/hr/Docs/archive.zip', 'archive.zip', 'zip']
  ])('detects %s', (href: string, fileName: string, ext: string) => {
    const info: IDownloadInfo | undefined = detectDownload(href, BASE);
    expect(info && { fileName: info.fileName, ext: info.ext }).toEqual({ fileName, ext });
  });

  it.each([
    undefined,
    '',
    '/sites/hr/SitePages/News.aspx',
    '/sites/hr/Docs/Forms/AllItems.aspx?id=%2Fsites%2Fhr%2FDocs%2FFolder',
    '/sites/hr/images/logo.png',
    'mailto:someone@example.com',
    // Built at runtime so the no-script-url lint rule doesn't flag the literal.
    ['javascript', 'void(0)'].join(':'),
    '/sites/hr/Docs/.pdf',
    '/:w:/g/personal/x/EabcDEF'
  ])('ignores %p', (href: string | undefined) => {
    expect(detectDownload(href, BASE)).toBeUndefined();
  });

  it('returns the absolute href', () => {
    expect(detectDownload('Docs/a.pdf', BASE)!.href).toBe('https://contoso.example.com/sites/hr/SitePages/Docs/a.pdf');
  });
});

describe('installDownloadListener (jsdom)', () => {
  // jsdom can't navigate: cancel link default actions in the bubble phase.
  const preventNavigation = (e: Event): void => e.preventDefault();
  beforeAll(() => document.addEventListener('click', preventNavigation));
  afterAll(() => document.removeEventListener('click', preventNavigation));

  let found: IDownloadInfo[];
  let remove: () => void;

  beforeEach(() => {
    found = [];
    document.body.innerHTML =
      '<a id="pdf" href="/files/report.pdf"><span id="inner">Report</span></a>' +
      '<a id="page" href="/sites/hr/SitePages/News.aspx">News</a>' +
      '<div id="plain">text</div>';
    remove = installDownloadListener(document, () => BASE, (i: IDownloadInfo) => found.push(i), () => undefined);
  });

  afterEach(() => remove());

  it('fires for a click on a nested element inside a document link', () => {
    document.getElementById('inner')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(found.map((f) => f.fileName)).toEqual(['report.pdf']);
  });

  it('fires in capture phase even if the page stops propagation', () => {
    document.getElementById('pdf')!.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    });
    document.getElementById('pdf')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(found.length).toBe(1);
  });

  it('ignores non-document links and non-links', () => {
    document.getElementById('page')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.getElementById('plain')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(found.length).toBe(0);
  });

  it('middle click (auxclick button 1) counts, right click (button 2) does not', () => {
    document.getElementById('pdf')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    document.getElementById('pdf')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }));
    expect(found.length).toBe(1);
  });

  it('stops listening after remove()', () => {
    remove();
    document.getElementById('pdf')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(found.length).toBe(0);
  });

  it('reports handler errors instead of throwing', () => {
    remove();
    const errors: unknown[] = [];
    remove = installDownloadListener(
      document,
      () => {
        throw new Error('boom');
      },
      () => undefined,
      (e: unknown) => errors.push(e)
    );
    document.getElementById('pdf')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(errors.length).toBe(1);
  });
});
