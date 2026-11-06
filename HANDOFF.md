# HANDOFF — Eulerian tracking for SharePoint Online

Read this whole file before writing code. It records the decisions already made, what is still open, and the plan for the first session.

## 1. Goal

Build a single installable package that adds Eulerian Marketing Platform tracking to every modern page of a SharePoint Online tenant. The customer's SharePoint admin installs one `.sppkg` file, sets the configuration, and tracking runs on all sites. No code changes or rebuilds on the customer side.

## 2. Decisions already made (do not revisit without asking)

- **Monolith.** One repository, one SPFx solution, one `.sppkg`. No separate npm packages and no "core + adapter" split into modules. Internal folders are fine for readability and testing, but everything ships in one bundle.
- **Technology.** SharePoint Framework (SPFx) Application Customizer, written in TypeScript (SPFx requires it). No UI framework: no React, no Vue. The test harness backend is Perl (Mojolicious::Lite). The developer's usual stack is Perl backend and JS/Vue 2 frontend, so keep the TypeScript plain and readable.
- **Target.** SharePoint Online modern pages. Classic pages and SharePoint Server on-premises are out of scope for v1.
- **Transport: JSON POST to `collectorjson`, aligned with the official Eulerian SDKs. This is final.** The bundle builds the payload and POSTs it as a JSON body to `https://<collectorHost>/collectorjson/-/<unix-seconds>`, exactly like the iOS, Android, Flutter and React Native SDKs. No Eulerian JS loader, no `EA_push`, no form-encoded `/collector/` endpoint, no third-party script of any kind. *(Update 2026-11-06: `-` is replaced by the mandatory `siteName` setting, `/collectorjson/<siteName>/<unix-seconds>`; see section 4.)*
- **Payload format = the official SDKs' format.** Same keys, same nesting (section 3). When in doubt, do what `eanalytics-react-native` does.
- **Configuration at install time, not build time.** All customer-specific values come from the extension's `ComponentProperties` JSON (set in the Tenant Wide Extensions list). The same `.sppkg` must work for any customer.
- **CSP-safe.** SharePoint Online enforces Content Security Policy on modern pages since March 2026. No inline `<script>`, no `eval`, no string-injected script tags. Since we load no external script, no Trusted Script Sources change is needed on the customer side.
- **User identifiers are extra fields on the same hit, never separate calls.** Every hit is exactly one POST. Two admin settings, both off by default, control them (`setUid`, `setEmailHash`, section 5). The legal responsibility for enabling them sits with the customer; the README must say so plainly.
  - `uid` = the user's **Microsoft Entra ID object ID, sent in clear** (GUID, lowercase, with hyphens). Read it from `pageContext.aadInfo.userId`. Used for cross-reconciliation with other Microsoft 365 / HR data.
  - `email` = the user's email, normalised (trimmed, lowercased) and hashed with **SHA-256, output as lowercase hex** (64 characters). Added only if an email is available. The key is `email` (not `eemail`): that is what all four official SDKs send, and their docs say the value should be SHA-256 of the lowercased email.
  - Each field is independent: if the object ID is missing, no `uid`; if the email is missing, no `email`. Never substitute one identifier for another.
  - Implementation: every tag builder (page, search, action) inherits `.setUid(value)` and `.setEmailHash(value)` from a common base builder, mirroring the SDKs' `.setUID()` / `.setEmail()` (both write a plain field on the same payload). One central function applies identity and consent to every builder just before `.build()`, so no tag type can forget them.
- **Visitor identifier (`euidl`).** A random UUID (`crypto.randomUUID()`) generated in the browser and stored in `localStorage` under the key `eulerian-euidl` on the SharePoint origin, reused on every hit. This mirrors the iOS SDK, which generates a random UUID once and persists it under the same key name. Each browser/device is a separate visitor until `uid` links them; that is accepted.
- **Public open-source repository.** Public GitHub repo, `.sppkg` distributed through public GitHub Releases. Never commit customer-specific values (collector hosts, tenant URLs) anywhere in the repo, including tests and examples: use obvious placeholders such as `collector.example.com`.
- **Consent: three modes only.** See section 6.

## 3. Reference material and protocol

### Sources

- **Official SDKs (primary reference for transport and payload):** https://github.com/EulerianTechnologies
  - **`eanalytics-react-native`** (TypeScript): the model to follow. Key files: `src/eAnalytics.ts` (endpoint), `src/utils/httpHelper.ts` (POST), `src/utils/helper.ts` (`mergeProperties`), `src/models/eaGeneric.ts`, `src/models/eaSearch.ts`, `src/models/classes/action.ts`, `src/models/classes/params.ts`.
  - **`eanalytics-flutter`** (Dart): the only official SDK that also targets **Web**; on web it sets `url` to the current page URL. Use it to compare web-specific behaviour.
  - `eanalytics-android` (Java) and `eanalytics-ios` (Objective-C): same keys; cross-check if anything is unclear.
  - `eulerian-marketing-platform-chrome-devtools`: Chrome extension for debugging integrations; useful for manual tests.
- Eulerian Measurement Protocol API spec: https://doc.api.eulerian.com/#/section/eulerian-measurement-protocol (JavaScript-rendered; automated fetching returns an empty page; ask the developer for an extract if needed).
- Eulerian generic server-side guide (fetchable): https://doc.eulerian.com/p/dI5Qe1K_yqf7LG/Generic-implementation-guide-for-the-Eulerian-server-side-web-tagging-scheme. It documents the **form-encoded** `/collector/` variant, whose parameter names differ (`urlp`, `eise`, `actn0`...). We do **not** use those names; it is useful only for meanings (consent semantics, mandatory fields).

### Transport (as implemented in the RN SDK)

- URL: `https://<collectorHost>/collectorjson/-/<Math.floor(Date.now() / 1000)>` (the trailing epoch seconds act as a cache buster). *This extension uses `<siteName>` instead of `-` (section 4 update).*
- `POST`, header `Content-Type: application/json`.
- Body: a **JSON array** of hit objects. The SDKs batch stored hits up to 100,000 bytes per request; we send **one hit per request** (array of length 1), since we keep no offline queue in v1.
- Each hit object is a **flat merge** of three dictionaries (`internals`, `pages`, `properties` in the RN SDK; later keys overwrite earlier ones). Nested values exist only where shown below.

### Hit object keys we use

| Purpose | Key | Value |
|---|---|---|
| Device ID | `euidl` | localStorage UUID (mandatory on every hit) |
| Page URL | `url` | full `location.href` (mandatory on every hit; its domain must be declared on the Eulerian site) |
| Hit time | `ereplay-time` | Unix seconds, as the SDKs do |
| Page name | `path` | `pathPrefix\|<site url segment>\|<page name>` (the SDKs require it on every tag except standalone ones) |
| Page group | `pagegroup` | site title |
| Referrer | `rf` | previous in-app URL or `document.referrer` (not sent by the app SDKs; see open question 3) |
| Customer ID | `uid` | Entra object ID, if `setUid` |
| Hashed email | `email` | SHA-256 lowercase hex, if `setEmailHash` |
| Event-only hit | `ereplay-notag` | `1` (SDKs' `.setStandalone()`: does not count as a page view) |
| Actions | `actions` | array of objects `{ name, label, mode, ref, params: { key: value } }` (SDKs' `.putAction()`) |
| Search engine | `isearchengine` | engine name |
| Search results | `isearchresults` | number of results |
| Search params | `isearchparams` | object `{ key: value }` |
| Consent | `pmcat` / `enoepm` | see section 6 (the SDKs pass these through `.set(key, value)`) |
| Custom fields | any key | via `.set(key, value)` |

## 4. Open questions

1. **"Non-consented" mode.** The generic guide only documents `enoepm=1` (consent management disabled, everything collected). It does not document `enoepm=0` as "fully non-consented". The developer chose `enoepm=0`; confirm with Eulerian what it does. The documented alternative is `pmcat` listing every category ID, which requires the customer's category IDs. Implement as specified but keep this flagged.
2. **CORS on `collectorjson`.** A browser POST with `Content-Type: application/json` from a `*.sharepoint.com` page triggers a CORS preflight (`OPTIONS`). The collector must answer it with `Access-Control-Allow-Origin` (the SharePoint origin or `*`) and `Access-Control-Allow-Headers: Content-Type`. The app SDKs never hit this because native apps are not subject to CORS. **Test this early against the real collector** (section 11, step 3). If the preflight is not answered, report to the developer before working around it; the candidate workaround is sending the same JSON body with `Content-Type: text/plain`, which avoids the preflight, but only if Eulerian confirms the collector accepts it.
3. **Site resolution and `rf`.** The JSON endpoint has `-` instead of a site name in the path, so the site is presumably resolved from the collector host and/or the `url` domain. Confirm with Eulerian. Also confirm that `rf` is accepted as a flat key in the JSON format (the app SDKs don't send it).
4. **License** for the public repository: ask the developer before the first public release (Eulerian's own SDKs use MIT or Apache-2.0).

Resolved: transport (`collectorjson` JSON POST), `euidl` generation, `uid` (Entra object ID in clear), hashed email key (`email`), event-only hits (`ereplay-notag=1`).

**Update 2026-11-06 (developer decisions):**
- Q1 resolved: `enoepm=0` is the non-consented signal, no issue.
- Q2 resolved: the collector answers the CORS preflight, no issue.
- Q3 partly resolved: the Eulerian site is **a mandatory `siteName` setting**, sent in the endpoint path instead of `-`: `https://<collectorHost>/collectorjson/<siteName>/<unix-seconds>`. Whether `rf` is read in the JSON format is still open.
- Q4 resolved: the repository already ships an MIT `LICENSE`.
- New, open: whether SharePoint's CSP restricts `connect-src` is unknown and may vary per tenant. The README documents both cases (no restriction / restriction, with the steps for each).

## 5. Configuration (ComponentProperties)

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
  "debug": false
}
```

- `collectorHost`: required; no scheme, no slash, must not contain `.eulerian.com` (same validation as the SDKs' `init`). If missing or invalid, log one console warning and do nothing.
- `siteName`: **required** (added 2026-11-06, see section 4). Eulerian site name, used in the endpoint path `/collectorjson/<siteName>/<epoch>`. If missing or invalid, log one console warning and do nothing.
- `consentMode`: `"pmcat"` | `"consented"` | `"nonconsented"` (section 6).
- `pmcat`: used only when `consentMode` is `"pmcat"`; Eulerian IDs of refused categories separated by `-`, or `-` alone when everything is accepted.
- `setUid` (default `false`): add `uid` = Entra object ID in clear (from `pageContext.aadInfo.userId`) to every hit.
- `setEmailHash` (default `false`): add `email` = SHA-256 lowercase hex of the lowercased, trimmed `pageContext.user.email` to every hit. Compute the hash once per page load with `crypto.subtle.digest('SHA-256', ...)` and cache it in memory.
- `debug`: logs every payload to the console.

## 6. Consent

We don't know how each customer handles intranet consent, so v1 supports exactly three admin-chosen modes, and one of them is applied to every hit:

| `consentMode` | Added to every hit |
|---|---|
| `pmcat` | `"pmcat": "<config value>"` |
| `consented` | `"enoepm": "1"` (consent management disabled, all data collected) |
| `nonconsented` | `"enoepm": "0"` (to be confirmed with Eulerian, open question 1) |

No CMP integration and no per-user consent UI in v1. Implement this in `consent.ts` as a pure function from config to fields, with unit tests for all three modes.

## 7. Transport implementation

- One module, `transport.ts`, one function `send(hit: object)`.
- `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([hit]), keepalive: true, mode: 'cors', credentials: 'omit' })`.
- Do **not** use `navigator.sendBeacon`: browsers restrict it with an `application/json` body.
- `keepalive: true` lets the request outlive the page, which matters for download clicks that navigate away. Verify in the harness that download hits still arrive when the click opens or navigates to the file; preflighted keepalive requests have had uneven browser support.
- Fire-and-forget: no retry queue in v1. In `debug` mode, log the HTTP status when the response is readable.
- Verify in the harness and in a real browser that `connect-src` in SharePoint's CSP does not block the collector. If it does, document it as a blocker immediately.

## 8. Tracking specification (v1)

Every hit is one POST whose single hit object carries: `euidl`, `url`, `ereplay-time`, `rf` (when available), the consent field, plus `uid` if `setUid` is on and available, and `email` (hashed) if `setEmailHash` is on and an email is available.

| Event | When | Builder | Specific fields |
|---|---|---|---|
| Page view | Initial load and every in-app navigation | `EaGeneric` | `path` = `pathPrefix\|<site url segment>\|<page name>`; `pagegroup` = site title |
| Internal search | Page URL contains a `q` query parameter on a search page | `EASearch` | `path` as above; `isearchengine` = `sharepoint_search`; `isearchparams` = `{ "keyword": "<query>" }`; `isearchresults` if the count is readable |
| Document download/open | Click on a link to `.pdf .doc(x) .xls(x) .ppt(x)` and similar | `EaGeneric` + `.setStandalone()` + `.putAction()` | `ereplay-notag` = `1`; `actions` = `[{ "name": "download", "label": "<file name>", "params": { "ext": "<extension>" } }]` |

Rules:
- Use `this.context.application.navigatedEvent`; it can fire more than once per navigation. **Deduplicate** on the full URL (path + query).
- On in-app navigation, `rf` is the previous in-app URL, not `document.referrer` (which stays frozen at the first load).
- Downloads: one delegated `click` listener on `document` (capture phase). Many document clicks open Office for the web rather than a plain link; capture what is reliably capturable and document the gaps.
- Never throw. Every tracking failure is caught and logged only when `debug` is on. Tracking must never break a SharePoint page.

## 9. Toolchain

The developer has no SPFx background, so pick and document the toolchain:

- Use the **latest GA SPFx version** at scaffold time. Since SPFx 1.22, the build is Heft-based (gulp is legacy). As of mid-2026, SPFx 1.23 was current with Node.js 22 LTS. **Check the official "Set up your SharePoint Framework development environment" page first** and use the Node version it lists.
- Scaffold with the standard generator (`@microsoft/generator-sharepoint`). A new SPFx CLI was in preview to replace it; use it only if it is GA by now.
- Template: Extension > Application Customizer, no framework.
- Record the exact Node, SPFx and TypeScript versions in `README.md` and pin Node with `.nvmrc`.
- Write the build, package and test commands into `README.md` and an npm script for each, so the developer never needs to remember toolchain commands (`npm run build`, `npm run package`, `npm test`, `npm run harness`, `npm run e2e`).

## 10. Repository layout

```
eulerian-sharepoint/
├── HANDOFF.md
├── README.md                     # admin install guide + developer commands
├── LICENSE                       # to be chosen (open question 4)
├── .github/workflows/            # CI + release build
├── .nvmrc
├── docs/
│   └── eulerian-protocol.md      # transport + key reference (section 3), kept up to date
├── config/package-solution.json  # skipFeatureDeployment: true
├── sharepoint/assets/
│   ├── elements.xml
│   └── ClientSideInstance.xml    # auto-registers tenant-wide on deploy
├── src/extensions/eulerianTracking/
│   ├── EulerianTrackingApplicationCustomizer.ts
│   ├── EulerianTrackingApplicationCustomizer.manifest.json
│   └── lib/
│       ├── config.ts             # read + validate ComponentProperties
│       ├── context.ts            # SharePoint context behind a small interface
│       ├── identity.ts           # euidl, uid (Entra ID), email (hashed)
│       ├── tags/                 # EaGeneric, EASearch, Action, Params builders
│       ├── consent.ts
│       ├── transport.ts
│       ├── navigation.ts         # dedupe + in-app referrer
│       └── downloads.ts
├── test/unit/                    # Jest or Vitest
└── harness/
    ├── harness.pl                # Mojolicious fake collectorjson + strict CSP
    ├── public/index.html         # fake "SharePoint" pages using pushState
    └── e2e/                      # Playwright tests
```

`context.ts` exposes an interface such as `{ getUrl(), getSiteUrlSegment(), getSiteTitle(), getEntraObjectId(), getEmail(), onNavigate(cb) }`. The customizer implements it with SPFx; the harness implements it with plain browser APIs. Internal structure only; it ships in the same bundle.

## 11. Testing strategy (no SharePoint tenant available yet)

1. **Unit tests** (CI on every commit): builders produce the exact JSON hit objects (compare with what the RN SDK builders would produce for the same input); config validation; all three consent modes; `euidl` persistence; email hashing against a known test vector (`" Test@Example.com "` must hash the same as `"test@example.com"`; compute the expected value once with `printf '%s' test@example.com | sha256sum` and hard-code it); `uid` equals the Entra object ID in lowercase; no `uid` when the object ID is missing; no `email` when the email is empty; each flag works independently; dedupe and in-app referrer; download detection; transport URL format and body is a one-element JSON array.
2. **Local harness** (CI): `harness/harness.pl` runs two origins on two ports so cross-origin behaviour is real:
   - the **page origin** serves the built bundle and `index.html` with a strict CSP header (`script-src 'self'`); `index.html` loads the bundle as an external file and simulates navigation with `history.pushState`;
   - the **collector origin** answers `OPTIONS /collectorjson/:site/*` with CORS headers, accepts `POST /collectorjson/:site/:epoch` with a JSON array body, validates it, and stores hits; plus `GET /hits` and `POST /hits/reset`. Add a switch to disable the CORS headers so the failure mode is visible too.
   Playwright checks: one hit per navigation; `euidl`, `url`, `ereplay-time` and consent on every hit; same `euidl` across reloads; download hit arrives with `ereplay-notag=1`; no CSP errors in the console.
3. **Real Eulerian** (manual, as early as possible): point the harness at the real collector; confirm the preflight is answered (open question 2) and hits appear in the Eulerian interface.
4. **Real SharePoint** (manual, before release): a test site with a site collection app catalog in a customer tenant, a Microsoft 365 trial tenant, or a Developer Program sandbox if eligible. Application Customizers can't run in the workbench; debug them on a real page with the SPFx debug query parameters or debug toolbar.

## 12. Delivery

- Artifact: `eulerian-sharepoint.sppkg`, attached to a public GitHub Release. Add a GitHub Actions workflow that runs unit + harness tests on every push, and on a version tag (`v*`) builds the `.sppkg` and attaches it to the Release.
- The `.sppkg` version in `package-solution.json` must match the Git tag.
- Admin steps to document in `README.md`:
  1. Ask Eulerian to declare the tenant's SharePoint host (`<tenant>.sharepoint.com`) on the Eulerian site, and to allow it as a CORS origin on the collector, otherwise hits are rejected.
  2. Upload the `.sppkg` to the tenant App Catalog and make it available to all sites.
  3. Edit the entry in the Tenant Wide Extensions list and set `ComponentProperties` (section 5).
  4. Verify with the browser console (`debug: true`) and the Eulerian interface.
- Include a data section for the customer's DPO: what is collected, that `uid`, when enabled, is the user's Entra ID object ID in clear (directly identifying within the tenant), and that `email`, when enabled, is a SHA-256 hash of the email (pseudonymised, not anonymised: anyone holding the email can recompute it), how `euidl` is stored (`localStorage`), and the three consent modes.

## 13. Plan for the first session

1. Check the official SPFx environment page; install the listed Node version; scaffold the solution (Application Customizer, no framework). Commit.
2. Clone `eanalytics-react-native` and `eanalytics-flutter`; confirm section 3 against their source and write `docs/eulerian-protocol.md`.
3. Test the CORS preflight against a real collector if the developer can provide a test host (open question 2). This is the biggest risk; know the answer before building much on top.
4. Implement `config.ts`, `consent.ts`, `identity.ts`, and the tag builders, with unit tests.
5. Implement `navigation.ts` and `transport.ts`, with tests.
6. Wire the customizer: page view on `navigatedEvent`.
7. Build the harness; get one Playwright test green (page view on load + one `pushState` navigation, correct mandatory fields, preflight handled, no CSP errors).
8. Stop and report: what works, what is stubbed, and which open questions remain.

**Done for v1** when: page views, search and downloads are tracked in the harness as JSON hits on `collectorjson` with `euidl`, `url` and consent on every hit; no CSP violations; the `.sppkg` builds in ship mode; README covers installation, configuration, DPO information and developer commands.
