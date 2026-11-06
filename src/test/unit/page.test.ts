import { buildPagePath, pageNameFromUrl, searchKeyword } from '../../extensions/eulerianTracking/lib/page';

const HOST: string = 'https://contoso.example.com';

describe('pageNameFromUrl', () => {
  it.each([
    ['/sites/hr/SitePages/Home.aspx', 'Home'],
    ['/sites/hr/SitePages/Team%20News.aspx?web=1', 'Team News'],
    ['/_layouts/15/search.aspx/siteall?q=x', 'search'],
    ['/sites/hr', 'hr'],
    ['/', 'home'],
    ['', 'home']
  ])('%s -> %s', (path: string, name: string) => {
    expect(pageNameFromUrl(HOST + path)).toBe(name);
  });

  it('falls back to "home" on an unparseable URL', () => {
    expect(pageNameFromUrl('not a url')).toBe('home');
  });
});

describe('buildPagePath', () => {
  it('prefix|site segment|page name', () => {
    expect(buildPagePath('sharepoint', 'sites/hr', HOST + '/sites/hr/SitePages/Home.aspx')).toBe('sharepoint|sites/hr|Home');
  });

  it('root site becomes "root"; slashes are trimmed', () => {
    expect(buildPagePath('sharepoint', '', HOST + '/SitePages/Home.aspx')).toBe('sharepoint|root|Home');
    expect(buildPagePath('sharepoint', '/', HOST + '/')).toBe('sharepoint|root|home');
    expect(buildPagePath('sharepoint', '/sites/hr/', HOST + '/sites/hr/')).toBe('sharepoint|sites/hr|home');
  });

  it('replaces "|" inside parts', () => {
    expect(buildPagePath('sp', 'sites/a|b', HOST + '/sites/x/SitePages/A%7CB.aspx')).toBe('sp|sites/a-b|A-B');
  });
});

describe('searchKeyword', () => {
  it.each([
    ['/_layouts/15/search.aspx/siteall?q=holidays', 'holidays'],
    ['/sites/hr/_layouts/15/search.aspx?q=%20annual%20leave%20', 'annual leave'],
    ['/sites/hr/SitePages/Search.aspx?q=policy', 'policy']
  ])('%s -> %s', (path: string, keyword: string) => {
    expect(searchKeyword(HOST + path)).toBe(keyword);
  });

  it.each([
    '/sites/hr/SitePages/Home.aspx?q=not-a-search-page',
    '/_layouts/15/search.aspx/siteall',
    '/_layouts/15/search.aspx?q=',
    '/_layouts/15/search.aspx?q=%20%20'
  ])('no keyword for %s', (path: string) => {
    expect(searchKeyword(HOST + path)).toBeUndefined();
  });
});
