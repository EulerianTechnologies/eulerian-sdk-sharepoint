import { sanitizePathPart } from './config';

/**
 * Page naming and search detection, derived from the URL only (pure).
 *
 * path = "<pathPrefix>|<site url segment>|<page name>"
 *   site url segment : web server-relative URL without leading slash
 *                      ("sites/hr", "teams/sales/emea"), "root" for the root site
 *   page name        : last *.aspx segment without extension ("Home", "search"),
 *                      "home" for the bare site URL ("/sites/hr" itself),
 *                      otherwise the last path segment
 */

export const ROOT_SITE_SEGMENT: string = 'root';
export const DEFAULT_PAGE_NAME: string = 'home';
export const SEARCH_ENGINE_NAME: string = 'sharepoint_search';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function pageNameFromUrl(url: string, siteSegment?: string): string {
  const parsed: URL | undefined = parseUrl(url);
  if (!parsed) return DEFAULT_PAGE_NAME;
  const segments: string[] = parsed.pathname.split('/').filter((s: string) => s !== '');
  // Prefer the last ".aspx" segment: /_layouts/15/search.aspx/siteall -> "search"
  for (let i: number = segments.length - 1; i >= 0; i--) {
    const segment: string = safeDecode(segments[i]);
    if (/\.aspx$/i.test(segment)) return segment.replace(/\.aspx$/i, '');
  }
  if (segments.length === 0) return DEFAULT_PAGE_NAME;
  // The site's own URL (e.g. "/sites/hr") is its home page.
  const site: string = (siteSegment || '').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (site !== '' && safeDecode(segments.join('/')).toLowerCase() === safeDecode(site)) return DEFAULT_PAGE_NAME;
  return safeDecode(segments[segments.length - 1]);
}

export function normaliseSiteSegment(segment: string | undefined): string {
  const clean: string = (segment || '').replace(/^\/+|\/+$/g, '');
  return clean === '' ? ROOT_SITE_SEGMENT : safeDecode(clean);
}

export function buildPagePath(pathPrefix: string, siteSegment: string | undefined, url: string): string {
  return [pathPrefix, normaliseSiteSegment(siteSegment), pageNameFromUrl(url, siteSegment)].map(sanitizePathPart).join('|');
}

/**
 * Returns the search keyword when the URL is a search page with a non-empty
 * `q` parameter. Search pages: the Microsoft Search results page
 * (/_layouts/15/search.aspx[/siteall|/...]) and any page named "search.aspx"
 * (custom search pages such as SitePages/Search.aspx).
 */
export function searchKeyword(url: string): string | undefined {
  const parsed: URL | undefined = parseUrl(url);
  if (!parsed) return undefined;
  if (pageNameFromUrl(url).toLowerCase() !== 'search') return undefined;
  const keyword: string = (parsed.searchParams.get('q') || '').trim();
  return keyword === '' ? undefined : keyword;
}
