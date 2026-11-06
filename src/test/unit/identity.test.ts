import {
  EUIDL_STORAGE_KEY,
  IIdentity,
  IStorageLike,
  generateUuid,
  getOrCreateEuidl,
  hashEmail,
  normaliseEmail,
  normaliseEntraObjectId,
  resolveIdentity,
  utf8Encode
} from '../../extensions/eulerianTracking/lib/identity';
import { MemoryStorage, TEST_EMAIL_SHA256, nodeCrypto } from './helpers';

const UUID_V4: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('euidl', () => {
  it('generates and persists a UUID under "eulerian-euidl"', () => {
    const storage: MemoryStorage = new MemoryStorage();
    const euidl: string = getOrCreateEuidl(storage, () => generateUuid(nodeCrypto));
    expect(euidl).toMatch(UUID_V4);
    expect(storage.data[EUIDL_STORAGE_KEY]).toBe(euidl);
  });

  it('reuses the stored value across page loads', () => {
    const storage: MemoryStorage = new MemoryStorage();
    const first: string = getOrCreateEuidl(storage, () => generateUuid(nodeCrypto));
    const second: string = getOrCreateEuidl(storage, () => 'should-not-be-used');
    expect(second).toBe(first);
  });

  it('still returns an ID when storage throws', () => {
    const broken: IStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    expect(getOrCreateEuidl(broken, () => 'fresh-id')).toBe('fresh-id');
    expect(getOrCreateEuidl(undefined, () => 'fresh-id-2')).toBe('fresh-id-2');
  });

  it('falls back to getRandomValues, then Math.random, with a valid v4 UUID', () => {
    const viaRandomValues: string = generateUuid({
      getRandomValues: (a: Uint8Array) => {
        for (let i: number = 0; i < a.length; i++) a[i] = 255;
        return a;
      }
    });
    expect(viaRandomValues).toMatch(UUID_V4);
    expect(generateUuid(undefined)).toMatch(UUID_V4);
  });
});

describe('uid (Entra object ID)', () => {
  it('lowercases and keeps hyphens', () => {
    expect(normaliseEntraObjectId('A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF')).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
  });

  it('strips braces', () => {
    expect(normaliseEntraObjectId('{a1b2c3d4-e5f6-4711-8899-aabbccddeeff}')).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
  });

  it.each([undefined, '', 'not-a-guid', '00000000-0000-0000-0000-000000000000', 42])('rejects %p', (raw: unknown) => {
    expect(normaliseEntraObjectId(raw)).toBeUndefined();
  });
});

describe('email hash', () => {
  it('normalises (trim + lowercase)', () => {
    expect(normaliseEmail(' Test@Example.com ')).toBe('test@example.com');
    expect(normaliseEmail('')).toBeUndefined();
    expect(normaliseEmail('   ')).toBeUndefined();
    expect(normaliseEmail('no-at-sign')).toBeUndefined();
  });

  it('matches the sha256sum test vector', async () => {
    expect(await hashEmail('test@example.com', nodeCrypto)).toBe(TEST_EMAIL_SHA256);
  });

  it('hashes " Test@Example.com " like "test@example.com"', async () => {
    expect(await hashEmail(' Test@Example.com ', nodeCrypto)).toBe(TEST_EMAIL_SHA256);
  });

  it('outputs 64 lowercase hex chars', async () => {
    expect(await hashEmail('Someone@Example.org', nodeCrypto)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resolves undefined for an empty email', async () => {
    expect(await hashEmail('', nodeCrypto)).toBeUndefined();
  });

  it('encodes UTF-8 like TextEncoder', () => {
    expect(Array.from(utf8Encode('é€😀'))).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
  });
});

describe('resolveIdentity', () => {
  const sources = {
    getEntraObjectId: () => 'A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF',
    getEmail: () => ' Test@Example.com '
  };

  it('both flags off: euidl only', async () => {
    const id: IIdentity = await resolveIdentity({ setUid: false, setEmailHash: false }, sources, new MemoryStorage(), nodeCrypto);
    expect(Object.keys(id)).toEqual(['euidl']);
  });

  it('setUid only', async () => {
    const id: IIdentity = await resolveIdentity({ setUid: true, setEmailHash: false }, sources, new MemoryStorage(), nodeCrypto);
    expect(id.uid).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
    expect(id.emailHash).toBeUndefined();
  });

  it('setEmailHash only', async () => {
    const id: IIdentity = await resolveIdentity({ setUid: false, setEmailHash: true }, sources, new MemoryStorage(), nodeCrypto);
    expect(id.uid).toBeUndefined();
    expect(id.emailHash).toBe(TEST_EMAIL_SHA256);
  });

  it('never substitutes one identifier for the other', async () => {
    const noId = { getEntraObjectId: () => undefined, getEmail: () => 'test@example.com' };
    const a: IIdentity = await resolveIdentity({ setUid: true, setEmailHash: true }, noId, new MemoryStorage(), nodeCrypto);
    expect(a.uid).toBeUndefined();
    expect(a.emailHash).toBe(TEST_EMAIL_SHA256);

    const noEmail = { getEntraObjectId: sources.getEntraObjectId, getEmail: () => '' };
    const b: IIdentity = await resolveIdentity({ setUid: true, setEmailHash: true }, noEmail, new MemoryStorage(), nodeCrypto);
    expect(b.uid).toBe('a1b2c3d4-e5f6-4711-8899-aabbccddeeff');
    expect(b.emailHash).toBeUndefined();
  });

  it('never rejects: throwing sources or missing WebCrypto just drop the field', async () => {
    const throwing = {
      getEntraObjectId: (): string => {
        throw new Error('boom');
      },
      getEmail: (): string => {
        throw new Error('boom');
      }
    };
    const errors: string[] = [];
    const a: IIdentity = await resolveIdentity({ setUid: true, setEmailHash: true }, throwing, undefined, nodeCrypto, (m: string) =>
      errors.push(m)
    );
    expect(a.uid).toBeUndefined();
    expect(a.emailHash).toBeUndefined();
    expect(errors.length).toBe(2);

    const b: IIdentity = await resolveIdentity({ setUid: false, setEmailHash: true }, sources, undefined, { randomUUID: () => 'x' });
    expect(b).toEqual({ euidl: 'x' });
  });
});
