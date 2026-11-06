/**
 * Reads and validates the extension's ComponentProperties (set by the tenant
 * admin in the Tenant Wide Extensions list). Pure function: no DOM access.
 *
 * Any invalid configuration disables tracking entirely (the caller logs one
 * warning and stops). We never "guess" a value that could send data the admin
 * did not intend to send.
 */

export type ConsentMode = 'pmcat' | 'consented' | 'nonconsented';

export interface ITrackingConfig {
  collectorHost: string;
  /** Eulerian site name; replaces the SDKs' "-" in /collectorjson/<siteName>/<epoch>. */
  siteName: string;
  consentMode: ConsentMode;
  /** Only meaningful when consentMode === 'pmcat'. */
  pmcat: string;
  setUid: boolean;
  setEmailHash: boolean;
  trackDownloads: boolean;
  trackSearch: boolean;
  pathPrefix: string;
  debug: boolean;
}

export type ConfigResult =
  | { ok: true; config: ITrackingConfig }
  | { ok: false; error: string };

// Same host regex as the official SDKs' Helper.isHostValid (RN, Android, iOS):
// dot-separated labels of letters, digits and inner hyphens. Rejects schemes,
// slashes, ports, spaces and empty strings.
const HOST_REGEX: RegExp =
  /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9])$/;

// pmcat: Eulerian category IDs separated by '-', or '-' alone (all accepted).
// Kept permissive on the ID charset (letters/digits) since IDs come from the
// customer's Eulerian setup; only the separator structure is enforced.
const PMCAT_REGEX: RegExp = /^(-|[A-Za-z0-9]+(-[A-Za-z0-9]+)*-?)$/;

// Eulerian site name: letters, digits, "_", "-", "." (starting with a letter or
// digit, so "-" — the SDKs' placeholder — is rejected). Max 64 characters.
const SITE_NAME_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const CONSENT_MODES: ConsentMode[] = ['pmcat', 'consented', 'nonconsented'];

export const DEFAULT_PATH_PREFIX: string = 'sharepoint';

export function isValidCollectorHost(host: unknown): host is string {
  return (
    typeof host === 'string' &&
    host.length > 0 &&
    host.length <= 253 &&
    HOST_REGEX.test(host) &&
    // The SDKs refuse Eulerian's own domains: customers must use their
    // dedicated (first-party style) collector host.
    host.toLowerCase().indexOf('.eulerian.com') === -1
  );
}

/**
 * Admins edit ComponentProperties as raw JSON, so accept both real booleans
 * and the strings "true"/"false". Anything else falls back to the default.
 */
function readBool(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value: unknown = raw[key];
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

/** '|' separates path levels in Eulerian, so it must not appear inside one. */
export function sanitizePathPart(value: string): string {
  return value.replace(/\|/g, '-').trim();
}

export function readConfig(input: unknown): ConfigResult {
  // SPFx may hand over undefined/null when ComponentProperties is empty.
  if (input === null || typeof input !== 'object') {
    return { ok: false, error: 'ComponentProperties is missing or not a JSON object.' };
  }
  const raw: Record<string, unknown> = input as Record<string, unknown>;

  const collectorHost: unknown = typeof raw.collectorHost === 'string' ? raw.collectorHost.trim() : raw.collectorHost;
  if (!isValidCollectorHost(collectorHost)) {
    return {
      ok: false,
      error:
        '"collectorHost" is missing or invalid. Expected a bare host name such as ' +
        '"collector.example.com" (no scheme, no slash, no port, not *.eulerian.com).'
    };
  }

  // siteName is required: it selects the Eulerian site in the endpoint path.
  const siteName: unknown = typeof raw.siteName === 'string' ? raw.siteName.trim() : raw.siteName;
  if (typeof siteName !== 'string' || !SITE_NAME_REGEX.test(siteName)) {
    return {
      ok: false,
      error:
        '"siteName" is missing or invalid. Expected your Eulerian site name, such as "my-site" ' +
        '(letters, digits, "_", "-", "."; provided by Eulerian).'
    };
  }

  // consentMode is required: defaulting it would silently pick a legal basis
  // on the customer's behalf.
  const consentMode: unknown = raw.consentMode;
  if (typeof consentMode !== 'string' || CONSENT_MODES.indexOf(consentMode as ConsentMode) === -1) {
    return {
      ok: false,
      error: '"consentMode" is missing or invalid. Expected "pmcat", "consented" or "nonconsented".'
    };
  }

  let pmcat: string = '';
  if (consentMode === 'pmcat') {
    pmcat = typeof raw.pmcat === 'string' ? raw.pmcat.trim() : '';
    if (!PMCAT_REGEX.test(pmcat)) {
      return {
        ok: false,
        error:
          '"pmcat" is missing or invalid. Expected refused category IDs separated by "-" ' +
          '(for example "2-5") or "-" alone when every category is accepted.'
      };
    }
  }

  let pathPrefix: string = DEFAULT_PATH_PREFIX;
  if (typeof raw.pathPrefix === 'string' && sanitizePathPart(raw.pathPrefix) !== '') {
    pathPrefix = sanitizePathPart(raw.pathPrefix);
  }

  return {
    ok: true,
    config: {
      collectorHost: collectorHost.toLowerCase(),
      siteName,
      consentMode: consentMode as ConsentMode,
      pmcat,
      setUid: readBool(raw, 'setUid', false),
      setEmailHash: readBool(raw, 'setEmailHash', false),
      trackDownloads: readBool(raw, 'trackDownloads', true),
      trackSearch: readBool(raw, 'trackSearch', true),
      pathPrefix,
      debug: readBool(raw, 'debug', false)
    }
  };
}
