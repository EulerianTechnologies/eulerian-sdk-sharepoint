# Eulerian Marketing Platform tracking for SharePoint Online

A SharePoint Framework (SPFx) Application Customizer that adds [Eulerian Marketing Platform](https://www.eulerian.com) tracking to every **modern page** of a SharePoint Online tenant.

- One `.sppkg` file, installed once by the SharePoint admin, active on all sites.
- Configured at install time through the **Tenant Wide Extensions** list. The same package works for every customer, with no rebuild.
- It loads no third-party script. Hits are sent as JSON `POST` requests to your Eulerian collector (`/collectorjson/`), the same protocol as the official Eulerian mobile SDKs. It is compatible with SharePoint's Content Security Policy: no inline script, no `eval`, and no "Trusted script sources" change needed.
- Tracks **page views** (including in-app navigation), **internal searches** and **document downloads/opens**.

Out of scope for v1: classic pages, SharePoint Server (on-premises), consent banners / CMP integration.

---

## Contents

- [Installation (SharePoint admin)](#installation-sharepoint-admin)
- [Configuration](#configuration)
- [What is tracked](#what-is-tracked)
- [Data collected (information for your DPO)](#data-collected-information-for-your-dpo)
- [SharePoint CSP and the collector](#sharepoint-csp-and-the-collector)
- [Troubleshooting](#troubleshooting)
- [Developer guide](#developer-guide)

---

## Installation (SharePoint admin)

### 1. Before installing: ask Eulerian

Ask your Eulerian contact to:

1. **declare your SharePoint host** (`<tenant>.sharepoint.com`) on your Eulerian site. Hits whose `url` domain is not declared are rejected.
2. **allow that host as a CORS origin on your collector.** Browsers send a CORS preflight before each hit, and without it they block the request. The collector must answer `OPTIONS` with `Access-Control-Allow-Origin` (your SharePoint origin or `*`) and `Access-Control-Allow-Headers: Content-Type`.

You'll also need two values provided by Eulerian:

- your **collector host name** (for example `collector.example.com`),
- your **Eulerian site name** (for example `my-site`). Hits are sent to `https://<collector host>/collectorjson/<site name>/…`, so the site name selects which Eulerian site receives them.

Finally, check how your tenant's Content Security Policy treats requests to the collector: see [SharePoint CSP and the collector](#sharepoint-csp-and-the-collector).

### 2. Upload the package

1. Download `eulerian-sharepoint.sppkg` from the [GitHub Releases](https://github.com/EulerianTechnologies/eulerian-sdk-sharepoint/releases) page.
2. In the **SharePoint admin center**, open **More features → Apps → App Catalog** (or go straight to your tenant App Catalog site), then **Apps for SharePoint**.
3. Upload the `.sppkg`. In the dialog, check **"Make this solution available to all sites in the organization"** and click **Deploy**.

This creates an entry named **EulerianTracking** in the **Tenant Wide Extensions** list of the App Catalog site. The entry ships with an **empty `collectorHost`, `siteName` and `consentMode` on purpose**: tracking stays inactive until you configure it.

### 3. Configure

1. On the App Catalog site, open **Site contents → Tenant Wide Extensions**.
2. Edit the **EulerianTracking** item and set **Component Properties** to your configuration (see [Configuration](#configuration)), for example:

   ```json
   {
     "collectorHost": "collector.example.com",
     "siteName": "my-site",
     "consentMode": "pmcat",
     "pmcat": "-",
     "setUid": false,
     "setEmailHash": false,
     "trackDownloads": true,
     "trackSearch": true,
     "pathPrefix": "sharepoint",
     "debug": true
   }
   ```

3. Save. SharePoint caches tenant-wide extensions, so changes can take a few minutes to reach every page (a hard refresh helps).

### 4. Verify

1. With `"debug": true`, open any modern page, then the browser console (F12). You should see `[Eulerian] tracking started` and one `[Eulerian] POST https://<collectorHost>/collectorjson/<siteName>/...` line per page view, followed by `collector answered HTTP 200`.
2. In the **Network** tab, the request to `collectorjson` should be preceded by a successful `OPTIONS` (preflight). The console must show no `Refused to connect` CSP error (see [SharePoint CSP and the collector](#sharepoint-csp-and-the-collector)).
3. Check that the hits appear in the Eulerian interface.
4. Set `"debug": false` once everything works.

### Updating and removing

- **Update:** upload the new `.sppkg` to the App Catalog (replace the existing one) and deploy. Your Tenant Wide Extensions configuration is kept.
- **Pause:** in the Tenant Wide Extensions list, set the item's **Disabled** column to Yes (or clear `collectorHost`).
- **Remove:** delete the app from the App Catalog and the item from Tenant Wide Extensions.

---

## Configuration

All values come from the extension's **Component Properties** (JSON). An invalid configuration disables tracking. The extension then writes **one** console warning that explains which field is wrong, and sends nothing.

| Property | Type | Default | Description |
|---|---|---|---|
| `collectorHost` | string | — **(required)** | Your Eulerian collector host name: no `https://`, no slash, no port, not `*.eulerian.com`. |
| `siteName` | string | — **(required)** | Your Eulerian site name, provided by Eulerian. Used in the endpoint path: `/collectorjson/<siteName>/<epoch>`. Letters, digits, `_`, `-`, `.`; starts with a letter or digit; max 64 characters. |
| `consentMode` | `"pmcat"` \| `"consented"` \| `"nonconsented"` | — **(required)** | Consent signal added to every hit, see below. Required so the legal basis is always an explicit admin choice. |
| `pmcat` | string | — | Only in `pmcat` mode (required there): Eulerian IDs of **refused** categories separated by `-` (e.g. `"2-5"`), or `"-"` alone when every category is accepted. |
| `setUid` | boolean | `false` | Adds `uid` = the user's **Microsoft Entra ID object ID, in clear**. |
| `setEmailHash` | boolean | `false` | Adds `email` = **SHA-256** (lowercase hex) of the user's trimmed, lowercased email. |
| `trackDownloads` | boolean | `true` | Tracks clicks on links to documents. |
| `trackSearch` | boolean | `true` | Tracks SharePoint search pages as internal searches. |
| `pathPrefix` | string | `"sharepoint"` | First level of the page name (`path`). `\|` is replaced by `-`. |
| `debug` | boolean | `false` | Logs every payload and the collector's HTTP status to the browser console. |

Booleans also accept the strings `"true"` / `"false"`.

### Consent modes

v1 doesn't integrate with any consent banner: the admin picks **one** mode for the whole tenant.

| `consentMode` | Sent on every hit | Meaning |
|---|---|---|
| `pmcat` | `"pmcat": "<your value>"` | Eulerian consent categories: the listed category IDs are refused; `-` = all accepted. |
| `consented` | `"enoepm": "1"` | Consent management disabled: everything is collected. |
| `nonconsented` | `"enoepm": "0"` | No consent. |

---

## What is tracked

Every hit is **one** `POST` to `https://<collectorHost>/collectorjson/<siteName>/<unix-seconds>` whose body is a one-element JSON array. Each hit always contains:

- `euidl` (visitor ID),
- `url` (full page URL),
- `ereplay-time` (Unix seconds),
- `ereplay-platform` = `sharepoint` and `ea-sharepoint-sdk` = the extension version (e.g. `0.1.0`), to identify SharePoint traffic,
- the consent field,
- `rf` (referrer) when available,
- `uid` / `email` only if enabled and available.

| Event | When | Specific fields |
|---|---|---|
| **Page view** | First load and every in-app navigation (SharePoint is a single-page app). Duplicate navigation events for the same URL are ignored. | `path` = `/<pathPrefix>\|<site>\|<page>` (e.g. `/sharepoint\|sites/hr\|Home`; the root site is `root`), `pagegroup` = site title. `rf` = `document.referrer` on the first view, then the previous page. |
| **Internal search** | A search page (`/_layouts/15/search.aspx…` or any `…/Search.aspx`) with a non-empty `q` parameter. Replaces the plain page view for that URL. | `isearchengine` = `{ "name": "sharepoint_search", "params": { "keyword": "<query>" } }`. |
| **Document download/open** | Click (left, middle, Ctrl/Shift, keyboard) on a link to `pdf`, Word, Excel, PowerPoint, OpenDocument, Visio, `csv`, `txt`, `rtf`, `zip`… files. | Event only (`ereplay-notag: 1`, not a page view), `actions` = `[{ "name": "download", "label": "<file name>", "params": { "ext": "<ext>" } }]`. |

The exact payloads are in [docs/eulerian-protocol.md](docs/eulerian-protocol.md).

### About the referrer (`rf`)

- **In-app navigation** (most clicks inside SharePoint, which is a single-page app): the browser does not update `document.referrer`, so the extension sends the **previous SharePoint page URL** it tracked itself. This is always available.
- **First page of a visit, or a full page reload** (opening a link, cross-site navigation that reloads the page): `rf` is the browser's `document.referrer`, which depends on where the visitor came from:
  - another SharePoint page (same `<tenant>.sharepoint.com` origin): the full URL;
  - another website or web app (Outlook on the web, Teams web, an intranet portal): usually **only the origin** (e.g. `https://outlook.office.com/`), because browsers default to the `strict-origin-when-cross-origin` referrer policy, or nothing if that site sends `no-referrer`;
  - a typed URL, a bookmark, or a link opened from a desktop app (Outlook, Teams desktop, Office): **empty**, so `rf` is not sent.

### Known gaps (downloads and search)

Download detection relies on a link (`<a href>`) that names the file. It works for direct file links, Office for the web links (`Doc.aspx?…&file=Report.docx`), `download.aspx?SourceUrl=…` and library preview links (`AllItems.aspx?id=…/file.pdf`). It **does not** see:

- sharing links that don't contain the file name (`/:w:/g/…`, `/:b:/r/…` short links),
- files opened from a document library row (SharePoint opens them by script, without a link),
- the **Download** button of the command bar and the file viewer's own buttons,
- files opened outside SharePoint pages (Teams, OneDrive app, Office desktop).

The number of search results (`results` in `isearchengine`) is not sent. Microsoft Search renders it asynchronously, with no stable element to read it from.

---

## Data collected (information for your DPO)

**The customer (data controller) decides which identifiers are enabled and is responsible for the legal basis and for informing employees.** Both user identifiers are **off by default**.

| Data | When | Nature |
|---|---|---|
| `euidl` | Always | Random UUID generated in the browser and stored in **`localStorage`** under the key `eulerian-euidl` on the SharePoint origin (`<tenant>.sharepoint.com`). It is not a cookie and it is not linked to the user's account. Each browser/device gets its own value. The user can clear it by clearing site data. |
| `url`, `path`, `pagegroup`, `rf` | Always | Visited SharePoint page URL, page name, site title and previous page. Page URLs and titles can themselves contain information (site names, search terms in `q`). |
| Search keyword | `trackSearch: true` | The text typed in SharePoint search. Users may type personal data. |
| Downloaded file name and extension | `trackDownloads: true` | File names can reveal information. |
| `uid` | `setUid: true` | The user's **Microsoft Entra ID object ID, in clear**. It **directly identifies** the employee within your tenant (it can be looked up in Entra ID), and is meant for reconciliation with other Microsoft 365 / HR data. |
| `email` | `setEmailHash: true` | **SHA-256 hash** of the lowercased email. It is **pseudonymised, not anonymised**: anyone who knows an email address can recompute its hash and match it. |
| Consent field | Always | `pmcat` or `enoepm`, as configured. |

Not collected: IP addresses are not added to the payload by the extension. The collector sees the request's IP like any web request; check Eulerian's processing terms. The extension also sends no cookies (`credentials: 'omit'`) and no device fingerprint.

All hits go only to the collector host you configure.

---

## SharePoint CSP and the collector

Since 2026, SharePoint Online enforces a Content Security Policy on modern pages. This extension is designed to need **no CSP change for its code**:

- the bundle is packaged inside the `.sppkg` (`includeClientSideAssets`) and served by SharePoint itself, not from an external CDN;
- it loads no external script and uses no inline script and no `eval`.

The one open point is the **network request to the collector** (`fetch` to `https://<collectorHost>`), which a CSP governs through `connect-src`, not `script-src`. Microsoft's public guidance so far covers script sources (the **Trusted script sources** list). We have not confirmed whether SharePoint also restricts `connect-src` in your tenant. Check it once, then follow the matching case.

**How to check:** open a modern page with `"debug": true` and the browser console open (F12):

- `[Eulerian] collector answered HTTP 200` and **no** `Refused to connect … "connect-src"` message → **case A**;
- `Refused to connect to 'https://<collectorHost>/…' because it violates … "connect-src"` → **case B**.

You can also look for the response header `Content-Security-Policy` (or `…-Report-Only`) on the page in the **Network** tab and check whether it contains a `connect-src` directive that doesn't allow your collector host. Microsoft Purview audit also lists blocked resources (activity "Violated Content Security Policy").

### Case A: the tenant CSP doesn't restrict `connect-src`

Nothing to do. Hits go straight to the collector.

### Case B: the tenant CSP restricts `connect-src`

The browser blocks every hit before it leaves the page. The page itself keeps working, because the extension catches the error. To unblock it:

1. In the **SharePoint admin center**, open **Advanced → Script sources** (Trusted script sources) and add your collector origin exactly: `https://<collectorHost>`. Avoid wildcards, which SharePoint refuses when they are too broad.
2. Wait for propagation (it can take a while), hard-refresh, and check the console again.
3. If the error persists, the tenant's `connect-src` is not driven by that list. Contact Microsoft support with the exact console message, and tell Eulerian. Until it's solved, tracking can't work on that tenant. As a stopgap, set `"collectorHost": ""` (or disable the Tenant Wide Extensions entry) to stop the useless requests.

If your tenant delays CSP enforcement (`Set-SPOTenant -DelayContentSecurityPolicyEnforcement $true`), violations are only reported, not blocked. Re-check after the delay ends.

---

## Troubleshooting

| Symptom (browser console) | Cause / fix |
|---|---|
| `[Eulerian] tracking disabled: "collectorHost" is missing or invalid…` (or `"siteName"`, `"consentMode"`, `"pmcat"`) | Fix the JSON in Tenant Wide Extensions. The message names the faulty field. |
| `Access to fetch … has been blocked by CORS policy` | The collector doesn't answer the preflight for your SharePoint origin. Ask Eulerian (installation step 1). |
| `Refused to connect to … because it violates the … Content Security Policy directive "connect-src"` | Your tenant's CSP blocks requests to the collector host. See [case B](#case-b-the-tenant-csp-restricts-connect-src). |
| No `[Eulerian]` line at all with `debug: true` | Is the extension enabled in Tenant Wide Extensions and deployed to all sites? Is it a **modern** page? Is the configuration cached? Wait a few minutes or hard-refresh. |
| Requests visible but nothing in Eulerian | Wrong `siteName`, or the SharePoint host is not declared on that Eulerian site (installation step 1). |
| Requests blocked by the browser itself | Some ad/privacy blockers block analytics endpoints. This is outside the extension's control. |

---

## Developer guide

### Toolchain (versions used and tested)

| Tool | Version | Notes |
|---|---|---|
| Node.js | **26.13.0** (Node 26 LTS, pinned in `.nvmrc`) | SPFx 1.24 also supports Node 22.14+ and 24. |
| SharePoint Framework | **1.24.1** | Heft-based toolchain (gulp is legacy). Scaffolded with `@microsoft/generator-sharepoint@1.24.1` (the new SPFx CLI is still pre-release). |
| TypeScript | **5.8.3** | Bundled by SPFx. Compile target ES5 (SPFx default). |
| Heft | 1.3.2 | Runs TypeScript, ESLint, Jest and Webpack. |
| Jest | 30.2 (via Heft) | Unit tests, jsdom environment. |
| Playwright | 1.65.0 | Harness end-to-end tests (Chromium + Firefox). |
| Perl / Mojolicious | 5.36 / 9.31 | Test harness backend (`harness/harness.pl`). |

Setup:

```bash
nvm install && nvm use               # Node from .nvmrc
npm install
npm run e2e:install                  # Playwright browsers (once)
cpanm Mojolicious                    # or: apt install libmojolicious-perl
```

### Commands

| Command | What it does |
|---|---|
| `npm run build` | Compile + lint + bundle (debug build). |
| `npm test` | Build, then run the Jest unit tests. |
| `npm run package` | **Ship-mode** build + unit tests + `.sppkg` → `sharepoint/solution/eulerian-sharepoint.sppkg`. |
| `npm run harness` | Compile the harness bundle and start the harness on <http://127.0.0.1:8401/> (fake collector on `:8402`). |
| `npm run e2e` | Compile the harness bundle and run the Playwright tests (starts the harness itself). |
| `npm run version:check` | Check that `package.json` and `package-solution.json` versions agree (optionally with a tag: `npm run version:check -- v0.1.0`). |
| `npm start` | SPFx dev server, to debug on a real SharePoint page (see below). |

### Layout

```
src/extensions/eulerianTracking/
  EulerianTrackingApplicationCustomizer.ts   SPFx glue only: PageContext -> ITrackingContext
  lib/                                       all tracking logic, no SPFx import (shared with the harness)
    config.ts       read + validate ComponentProperties
    consent.ts      consent mode -> fields (pure)
    context.ts      ITrackingContext interface + console logger
    identity.ts     euidl (localStorage), uid (Entra ID), email (SHA-256)
    tags/           EaGenericBuilder, EASearchBuilder, ActionBuilder, ParamsBuilder (mirror the RN SDK)
    page.ts         path / page name / search detection from the URL
    navigation.ts   dedupe + in-app referrer
    downloads.ts    document link detection + delegated click listener
    transport.ts    JSON POST to collectorjson
    version.ts      extension version + platform name sent on every hit
    tracker.ts      wiring; finalizeHit() applies identity + referrer + consent to every builder
src/test/unit/      Jest unit tests (Heft only compiles src/, hence not a top-level test/ folder)
harness/
  harness.pl        Mojolicious: fake SharePoint origin (strict CSP) + fake collectorjson origin (CORS)
  src/              harness entry: same lib/ code with a browser-API ITrackingContext
  public/           app.js (fake SPA navigation with pushState), style.css
  e2e/              Playwright tests
  tsconfig.json     compiles lib/ + harness entry to ES modules in harness/public/build
docs/eulerian-protocol.md   protocol reference checked against the official SDKs
sharepoint/assets/          ClientSideInstance.xml (tenant-wide registration), elements.xml
.github/workflows/          ci.yml (every push), release.yml (tags v*)
```

### The local harness

`npm run harness` starts two origins, so cross-origin behaviour is real:

- `http://127.0.0.1:8401` — fake SharePoint pages with a strict CSP (`script-src 'self'`), running the real `lib/` code. Use the nav links, the search box and the document links.
- `http://127.0.0.1:8402` — fake collector. `GET /hits` lists the received hits, `POST /hits/reset` clears them, and `POST /control {"cors":0}` turns CORS off to show the failure mode.

Page options: `?config=<base64 JSON>` overrides Component Properties, and `?userId=` / `?userEmail=` set the fake user.

**Testing against the real Eulerian collector:**

```bash
HARNESS_REAL_COLLECTOR=<your-collector-host> HARNESS_SITE_NAME=<your-site> npm run harness
```

The page then posts to `https://<your-collector-host>/collectorjson/<your-site>/…`. In the browser devtools, check that the `OPTIONS` preflight succeeds. Note that `url` is then `http://127.0.0.1:8401/…`, which Eulerian will reject unless that domain is declared. **Never commit a real collector host or site name.**

### Debugging on a real SharePoint page

Application Customizers don't run in a workbench. Use a modern page of a test site:

```bash
export SPFX_SERVE_TENANT_DOMAIN=<tenant>.sharepoint.com
npm start
```

`config/serve.json` opens `https://<tenant>/SitePages/Home.aspx` with the debug query parameters and placeholder properties (edit `collectorHost` and `siteName` locally, don't commit them). Accept **Load debug scripts** in the browser.

### Releasing

1. Bump `version` in `package.json`, `solution.version` + the feature `version` in `config/package-solution.json` (`X.Y.Z` ↔ `X.Y.Z.0`), and `SDK_VERSION` in `src/extensions/eulerianTracking/lib/version.ts` (sent in every hit as `ea-sharepoint-sdk`). Run `npm run version:check`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. `release.yml` checks the versions, runs all tests, builds the `.sppkg` in ship mode and attaches it to a GitHub Release.

### Design decisions

These were settled at the start of the project. Don't revisit them without discussing first.

- **One SPFx solution, one bundle, one `.sppkg`.** Folders under `lib/` exist for readability and tests, not as separate packages.
- **Plain TypeScript, no UI framework** (no React/Vue). The harness backend is Perl (Mojolicious::Lite).
- **SharePoint Online modern pages only.** Classic pages and SharePoint Server are out of scope.
- **Transport = the official SDKs' JSON protocol** (`collectorjson`), one hit per POST, fire-and-forget (no queue, no retry), `fetch` with `keepalive` (not `sendBeacon`, which restricts `application/json` bodies). No Eulerian JS loader, no `EA_push`, no form-encoded `/collector/`.
- **Payload = the SDKs' keys and nesting.** The code mirrors `eanalytics-react-native`'s builders; where the SDKs disagree, follow the iOS/Android/Flutter SDKs (the most recent ones). For example, search uses their nested `isearchengine` object. See [docs/eulerian-protocol.md](docs/eulerian-protocol.md).
- **Configuration only at install time** (Component Properties). The same `.sppkg` serves every customer.
- **User identifiers are extra fields on the same hit**, never separate calls, and both are off by default. They are applied centrally by `finalizeHit()` (`lib/tracker.ts`) so no tag type can forget them. `uid` and `email` are independent: one never replaces the other.
- **`euidl`** is a random UUID in `localStorage["eulerian-euidl"]`, like the iOS SDK. Each browser/device is a separate visitor unless `uid` links them.
- **Consent: three admin-chosen modes only**, with no CMP integration and no consent UI.

### Rules for contributors

- No customer-specific values (collector hosts, tenant URLs) anywhere in the repo, including tests. Use placeholders such as `collector.example.com` and `contoso.example.com`.
- No external script and no `eval`/inline script. The bundle must stay CSP-safe.
- Tracking must never throw into the SharePoint page. Every failure is caught and logged only with `debug: true`.

---

## License

MIT, see [LICENSE](LICENSE).
