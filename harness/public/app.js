// Fake SharePoint single-page navigation for the harness.
// Loaded as an external file (the page CSP forbids inline scripts).
//
// Like SPFx's navigatedEvent, "harness:navigated" is dispatched TWICE per
// navigation so the tracker's deduplication is exercised.
(function () {
  'use strict';

  function siteFromPath(pathname) {
    var m = /^\/(sites|teams)\/([^/]+)/i.exec(pathname);
    return m ? m[1] + '/' + m[2] : '';
  }

  function render() {
    var site = siteFromPath(location.pathname);
    var title = site ? 'Site ' + site.split('/')[1].toUpperCase() : 'Root site';
    document.body.setAttribute('data-site-title', title);
    document.getElementById('site-title').textContent = title;
    document.getElementById('page-name').textContent = location.pathname + location.search;
  }

  function navigate(url) {
    history.pushState({}, '', url);
    render();
    document.dispatchEvent(new CustomEvent('harness:navigated'));
    document.dispatchEvent(new CustomEvent('harness:navigated'));
  }

  // In-app links: bubble phase, so the tracker's capture listener runs first.
  document.addEventListener('click', function (event) {
    var a = event.target.closest && event.target.closest('a[data-nav]');
    if (!a || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    navigate(a.getAttribute('href'));
  });

  document.getElementById('search').addEventListener('submit', function (event) {
    event.preventDefault();
    var q = document.getElementById('q').value;
    navigate('/_layouts/15/search.aspx/siteall?q=' + encodeURIComponent(q));
  });

  window.addEventListener('popstate', function () {
    render();
    document.dispatchEvent(new CustomEvent('harness:navigated'));
  });

  render();
})();
