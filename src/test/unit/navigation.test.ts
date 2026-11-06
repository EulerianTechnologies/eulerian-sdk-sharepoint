import { IPageVisit, NavigationTracker, navigationKey } from '../../extensions/eulerianTracking/lib/navigation';

const A: string = 'https://contoso.example.com/sites/hr/SitePages/Home.aspx';
const B: string = 'https://contoso.example.com/sites/hr/SitePages/News.aspx';
const C: string = 'https://contoso.example.com/sites/it/SitePages/Home.aspx?tab=1';

describe('NavigationTracker', () => {
  it('first visit uses document.referrer', () => {
    const nav: NavigationTracker = new NavigationTracker('https://www.example.org/');
    expect(nav.next(A)).toEqual({ url: A, referrer: 'https://www.example.org/' });
  });

  it('first visit has no referrer when document.referrer is empty', () => {
    expect(new NavigationTracker('').next(A)).toEqual({ url: A, referrer: undefined });
  });

  it('in-app visits use the previous in-app URL as referrer', () => {
    const nav: NavigationTracker = new NavigationTracker('https://www.example.org/');
    nav.next(A);
    expect(nav.next(B)).toEqual({ url: B, referrer: A });
    expect(nav.next(C)).toEqual({ url: C, referrer: B });
  });

  it('deduplicates repeated navigatedEvent firings for the same URL', () => {
    const nav: NavigationTracker = new NavigationTracker('');
    const visits: Array<IPageVisit | undefined> = [nav.next(A), nav.next(A), nav.next(A + '#section'), nav.next(B), nav.next(B)];
    expect(visits.filter(Boolean).length).toBe(2);
  });

  it('a different query string is a new page', () => {
    const nav: NavigationTracker = new NavigationTracker('');
    nav.next(C);
    expect(nav.next(C.replace('tab=1', 'tab=2'))).toBeDefined();
  });

  it('tracks A again after A -> B -> A', () => {
    const nav: NavigationTracker = new NavigationTracker('');
    nav.next(A);
    nav.next(B);
    expect(nav.next(A)).toEqual({ url: A, referrer: B });
  });

  it('navigationKey drops the hash only', () => {
    expect(navigationKey('https://x.example.com/p?q=1#h')).toBe('https://x.example.com/p?q=1');
  });
});
