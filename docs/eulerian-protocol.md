# Eulerian `collectorjson` protocol — reference for this project

This document records what the official Eulerian SDKs actually send, checked against their source code on 2026-11-06, and how this SharePoint extension maps onto it. Keep it up to date when the protocol or our payload changes.

Sources read (default branches, shallow clones):

| SDK | Files |
|---|---|
| `eanalytics-react-native` (TypeScript, **reference**) | `src/eAnalytics.ts`, `src/utils/httpHelper.ts`, `src/utils/helper.ts`, `src/utils/propertiesTracker.ts`, `src/models/eaGeneric.ts`, `src/models/eaSearch.ts`, `src/models/classes/action.ts`, `src/models/classes/params.ts` |
| `eanalytics-flutter` (Dart, also targets Web) | `lib/src/utils/post.dart`, `lib/src/models/EAProperty.dart`, `lib/src/models/EAGlobalParams.dart`, `lib/src/models/keys/EAPropertyKey.dart`, `lib/src/models/classes/Search.dart` |
| `eanalytics-android` (Java) | `EAnalytics.java`, `EAProperties.java`, `EASearch.java` |
| `eanalytics-ios` (Objective-C) | `EAnalytics.m`, `EAProperties.m`, `EASearch.m` |

## 1. Transport

All four SDKs agree:

```
POST https://<collectorHost>/collectorjson/-/<unix seconds>
Content-Type: application/json            (Flutter adds "; charset=UTF-8")
Body: [ <hit>, <hit>, ... ]               (JSON array)
```

- `<unix seconds>` = `Math.floor(Date.now() / 1000)` at send time. It works as a cache buster.
- The host is validated by the same regex everywhere (dot-separated labels of letters, digits and inner hyphens), and must not contain `.eulerian.com`.
- The SDKs batch stored hits (offline queue, up to 100,000 bytes per request in RN). Success is HTTP 200: Flutter checks `statusCode == 200`, and RN checks `response.ok`, then `response.json()`.

**This extension** differs on one point: it puts the **Eulerian site name** where the SDKs put `-`:

```
POST https://<collectorHost>/collectorjson/<siteName>/<unix seconds>
```

`siteName` is a mandatory setting (decision of 2026-11-06), so the target site never depends on server-side resolution. It is validated as `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` and URL-encoded.

It sends exactly one hit per request (`[hit]`) with `fetch(..., { keepalive: true, mode: 'cors', credentials: 'omit' })`. It has no queue and no retry (`lib/transport.ts`).

Browser-only concern: a cross-origin `application/json` POST triggers a **CORS preflight** (`OPTIONS`). The native SDKs never hit this. The collector answers the preflight with `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers: Content-Type`.

## 2. Hit object

RN builds three dictionaries and merges them flat, in this order (later keys win): `internals` → `pages` → `properties` (`Helper.mergeProperties`). Our `EaGenericBuilder` does the same.

| Key | RN dictionary | Our value | Notes |
|---|---|---|---|
| `euidl` | internals | random UUID v4, `localStorage["eulerian-euidl"]` | iOS: random UUID persisted in NSUserDefaults under `eulerian-euidl`. Android / RN-Android: `ANDROID_ID`. |
| `url` | internals | full `location.href` | RN/Android/iOS: `"http://" + bundleId`. **Flutter Web: `Uri.base.path` (path only).** We send the full URL, because the domain must match the domain declared on the Eulerian site. |
| `ereplay-time` | internals | Unix seconds (number) | Same in all SDKs. |
| `path` | pages | `"/" + pathPrefix\|<site segment>\|<page name>` | **All four SDKs prepend `/` when it's missing**, and our builder does the same. Example: `/sharepoint\|sites/hr\|Home`. |
| `pagegroup` | pages | site (web) title | `setPageGroup()` |
| `uid` | pages | Entra object ID, lowercase GUID | `setUID()`; only with `setUid: true`. |
| `email` | pages | SHA-256 hex of the trimmed, lowercased email | `setEmail()`; the SDKs send whatever the app passes, and their docs ask for SHA-256 of the lowercased email. Only with `setEmailHash: true`. |
| `rf` | pages | first view: `document.referrer`; after that: previous in-app URL | Not sent by the app SDKs; a flat key per the Eulerian Measurement Protocol. |
| `actions` | pages | `[{ name, label, mode?, ref?, params? }]` | `putAction()` |
| `ereplay-notag` | properties | `1` (number) | `setStandalone()` |
| `pmcat` / `enoepm` | properties | see section 3 | Passed as free keys (`set(key, value)`). |
| `isearchengine` / `isearchresults` / `isearchparams` | properties | see section 4 | |

Keys the app SDKs send that we deliberately leave out, because they have no meaning in a browser: `eos`, `ehw`, `ehw-identifier`, `ea-appname`, `ea-appversion`, `ea-appversionbuild`, the `ea-android-*` and `ea-ios-*` keys, and the SDK version keys. If Eulerian wants an integration marker, the natural choice is `ea-sharepoint-sdk-version`. It is not sent today.

## 3. Consent

The generic server-side guide defines `pmcat` (IDs of refused categories, `-` separated, `-` alone = all accepted) and `enoepm=1` (consent management disabled, everything collected). The JSON SDKs have no dedicated setter: these keys go through `.set()`.

| `consentMode` | Field on every hit |
|---|---|
| `pmcat` | `"pmcat": "<config>"` |
| `consented` | `"enoepm": "1"` |
| `nonconsented` | `"enoepm": "0"`: no consent |

## 4. Internal search — SDK divergence

The SDKs do **not** agree on the shape of the search fields:

**React Native (flat):**
```json
{ "isearchengine": "sharepoint_search", "isearchresults": 12, "isearchparams": { "keyword": "holidays" } }
```

**iOS, Android, Flutter (nested):**
```json
{ "isearchengine": { "name": "sharepoint_search", "results": 12, "params": { "keyword": "holidays" } } }
```

The project's tie-break rule ("when the SDKs disagree, do what `eanalytics-react-native` does") selects the **flat** form, and that is what we send. Three of the four SDKs (including both original native ones) use the nested form, so **ask Eulerian which form `collectorjson` reads**. Only `lib/tags/ea-search.ts` would need to change.

`isearchresults` is omitted in SharePoint: Microsoft Search renders its result count asynchronously, without a stable selector.

## 5. Actions (downloads)

Action JSON, as built by the RN `Action.Builder`:

```json
{ "name": "download", "label": "Q3 Report.pdf", "params": { "ext": "pdf" } }
```

The download hit is standalone (`ereplay-notag: 1`). It carries the `url`, `path` and `pagegroup` of the page where the link was clicked, and `rf` = that page URL.

## 6. Full examples (as sent by this extension)

Each body below is POSTed to `https://<collectorHost>/collectorjson/<siteName>/<unix seconds>`.

Page view, `consentMode: "pmcat"`, `pmcat: "-"`, both identity flags on:

```json
[{
  "euidl": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "url": "https://contoso.example.com/sites/hr/SitePages/News.aspx",
  "ereplay-time": 1767225600,
  "path": "/sharepoint|sites/hr|News",
  "pagegroup": "Human Resources",
  "uid": "a1b2c3d4-e5f6-4711-8899-aabbccddeeff",
  "email": "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
  "rf": "https://contoso.example.com/sites/hr/SitePages/Home.aspx",
  "pmcat": "-"
}]
```

Search, `consentMode: "consented"`:

```json
[{
  "euidl": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "url": "https://contoso.example.com/_layouts/15/search.aspx/siteall?q=annual%20leave",
  "ereplay-time": 1767225660,
  "path": "/sharepoint|root|search",
  "pagegroup": "Contoso Intranet",
  "rf": "https://contoso.example.com/sites/hr/SitePages/News.aspx",
  "isearchengine": "sharepoint_search",
  "isearchparams": { "keyword": "annual leave" },
  "enoepm": "1"
}]
```

Download:

```json
[{
  "euidl": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "url": "https://contoso.example.com/sites/hr/SitePages/News.aspx",
  "ereplay-time": 1767225720,
  "path": "/sharepoint|sites/hr|News",
  "pagegroup": "Human Resources",
  "rf": "https://contoso.example.com/sites/hr/SitePages/News.aspx",
  "actions": [{ "name": "download", "label": "Q3 Report.pdf", "params": { "ext": "pdf" } }],
  "ereplay-notag": 1,
  "pmcat": "-"
}]
```

## 7. Questions for Eulerian (summary)

1. Search: flat (`isearchengine` + `isearchresults` + `isearchparams`, as in RN) or nested (`isearchengine: { name, results, params }`, as in iOS/Android/Flutter)?
2. Does the leading `/` the SDKs add to `path` matter for reporting (`/sharepoint|sites/hr|Home`)?
3. Should we send an integration/version marker (for example `ea-sharepoint-sdk-version`)?
