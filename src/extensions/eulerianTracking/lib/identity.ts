/**
 * Visitor and user identifiers.
 *
 * - euidl : random UUID persisted in localStorage under "eulerian-euidl"
 *           (same key name the iOS SDK uses in NSUserDefaults). Always sent.
 * - uid   : Microsoft Entra ID object ID, in clear, lowercase GUID. Only when
 *           the admin enabled `setUid`.
 * - email : SHA-256 lowercase hex of the trimmed, lowercased email. Only when
 *           the admin enabled `setEmailHash`.
 *
 * uid and email are independent: a missing one never falls back to the other.
 */

export const EUIDL_STORAGE_KEY: string = 'eulerian-euidl';

export interface IStorageLike {
  // Mirrors the DOM Storage API, which returns null for missing keys.
  // eslint-disable-next-line @rushstack/no-new-null
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Subset of WebCrypto we use; injectable so tests can pass Node's webcrypto. */
export interface ICryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  subtle?: { digest(algorithm: string, data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> };
}

export interface IIdentity {
  euidl: string;
  uid?: string;
  emailHash?: string;
}

const GUID_REGEX: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hex2(n: number): string {
  return (n < 16 ? '0' : '') + n.toString(16);
}

/** RFC 4122 v4 UUID. Prefers crypto.randomUUID, falls back to getRandomValues. */
export function generateUuid(cryptoObj: ICryptoLike | undefined): string {
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID().toLowerCase();
  }
  const bytes: Uint8Array = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    // Last resort only (no WebCrypto at all): not cryptographically strong,
    // acceptable for a pseudonymous visitor ID.
    for (let i: number = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  let out: string = '';
  for (let i: number = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += hex2(bytes[i]);
  }
  return out;
}

/**
 * Reads the persisted euidl or creates and stores a new one. localStorage can
 * throw (blocked storage, private mode quirks): in that case we still return a
 * fresh UUID so the hit is valid; the visitor just won't be recognised later.
 */
export function getOrCreateEuidl(storage: IStorageLike | undefined, newUuid: () => string): string {
  try {
    const existing: string | undefined = storage ? storage.getItem(EUIDL_STORAGE_KEY) || undefined : undefined;
    if (existing && existing.trim() !== '') return existing;
  } catch {
    /* storage unreadable: fall through and generate */
  }
  const created: string = newUuid();
  try {
    if (storage) storage.setItem(EUIDL_STORAGE_KEY, created);
  } catch {
    /* storage unwritable: keep the in-memory value for this page load */
  }
  return created;
}

/**
 * SPFx exposes the object ID as a Guid whose toString() may vary in case and,
 * in some contexts, braces. Normalise to the lowercase hyphenated form and
 * reject anything that is not a GUID (never send garbage as uid).
 */
export function normaliseEntraObjectId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value: string = raw.trim().replace(/^\{|\}$/g, '').toLowerCase();
  if (!GUID_REGEX.test(value)) return undefined;
  // The all-zero GUID is what SPFx returns for anonymous/unknown users.
  if (value === '00000000-0000-0000-0000-000000000000') return undefined;
  return value;
}

export function normaliseEmail(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value: string = raw.trim().toLowerCase();
  return value.indexOf('@') > 0 ? value : undefined;
}

/** UTF-8 encoding without relying on TextEncoder (keeps the ES5 target and jsdom happy). */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i: number = 0; i < text.length; i++) {
    let code: number = text.charCodeAt(i);
    // Combine UTF-16 surrogate pairs into one code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next: number = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
  }
  return new Uint8Array(bytes);
}

export function sha256Hex(text: string, cryptoObj: ICryptoLike | undefined): Promise<string> {
  if (!cryptoObj || !cryptoObj.subtle) {
    return Promise.reject(new Error('WebCrypto subtle API unavailable (non-secure context?)'));
  }
  return cryptoObj.subtle.digest('SHA-256', utf8Encode(text)).then((buffer: ArrayBuffer) => {
    const bytes: Uint8Array = new Uint8Array(buffer);
    let out: string = '';
    for (let i: number = 0; i < bytes.length; i++) out += hex2(bytes[i]);
    return out;
  });
}

/** Normalises then hashes; resolves undefined when there is no usable email. */
export function hashEmail(raw: unknown, cryptoObj: ICryptoLike | undefined): Promise<string | undefined> {
  const email: string | undefined = normaliseEmail(raw);
  if (!email) return Promise.resolve(undefined);
  return sha256Hex(email, cryptoObj);
}

export interface IIdentityOptions {
  setUid: boolean;
  setEmailHash: boolean;
}

export interface IIdentitySources {
  getEntraObjectId(): string | undefined;
  getEmail(): string | undefined;
}

/**
 * Resolves the identity once per page load. The returned promise never
 * rejects: a hashing failure just means no `email` field.
 */
export function resolveIdentity(
  options: IIdentityOptions,
  sources: IIdentitySources,
  storage: IStorageLike | undefined,
  cryptoObj: ICryptoLike | undefined,
  onError?: (message: string, error: unknown) => void
): Promise<IIdentity> {
  const identity: IIdentity = {
    euidl: getOrCreateEuidl(storage, () => generateUuid(cryptoObj))
  };

  if (options.setUid) {
    let rawId: string | undefined;
    try {
      rawId = sources.getEntraObjectId();
    } catch (e) {
      if (onError) onError('Could not read the Entra object ID', e);
    }
    const uid: string | undefined = normaliseEntraObjectId(rawId);
    if (uid) identity.uid = uid;
  }

  if (!options.setEmailHash) return Promise.resolve(identity);

  let rawEmail: string | undefined;
  try {
    rawEmail = sources.getEmail();
  } catch (e) {
    if (onError) onError('Could not read the user email', e);
  }
  return hashEmail(rawEmail, cryptoObj).then(
    (hash: string | undefined) => {
      if (hash) identity.emailHash = hash;
      return identity;
    },
    (e: unknown) => {
      if (onError) onError('Could not hash the user email', e);
      return identity;
    }
  );
}
