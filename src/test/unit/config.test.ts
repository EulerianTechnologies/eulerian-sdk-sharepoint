import { ConfigResult, readConfig, isValidCollectorHost } from '../../extensions/eulerianTracking/lib/config';

const base = { collectorHost: 'collector.example.com', consentMode: 'consented' };

function expectError(input: unknown, fragment: string): void {
  const result: ConfigResult = readConfig(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain(fragment);
}

describe('readConfig', () => {
  it('applies defaults for optional fields', () => {
    const result: ConfigResult = readConfig(base);
    expect(result).toEqual({
      ok: true,
      config: {
        collectorHost: 'collector.example.com',
        consentMode: 'consented',
        pmcat: '',
        setUid: false,
        setEmailHash: false,
        trackDownloads: true,
        trackSearch: true,
        pathPrefix: 'sharepoint',
        debug: false
      }
    });
  });

  it('reads the full documented example', () => {
    const result: ConfigResult = readConfig({
      collectorHost: 'collector.example.com',
      consentMode: 'pmcat',
      pmcat: '-',
      setUid: true,
      setEmailHash: 'true',
      trackDownloads: false,
      trackSearch: 'false',
      pathPrefix: 'intranet',
      debug: true
    });
    expect(result.ok && result.config).toEqual({
      collectorHost: 'collector.example.com',
      consentMode: 'pmcat',
      pmcat: '-',
      setUid: true,
      setEmailHash: true,
      trackDownloads: false,
      trackSearch: false,
      pathPrefix: 'intranet',
      debug: true
    });
  });

  it.each([undefined, null, 'string', 42])('rejects a non-object config (%p)', (input: unknown) => {
    expectError(input, 'ComponentProperties');
  });

  it.each([
    undefined,
    '',
    'https://collector.example.com',
    'collector.example.com/',
    'collector.example.com:443',
    'collector example.com',
    'abc.eulerian.com',
    'ABC.EULERIAN.COM',
    '-bad.example.com'
  ])('rejects collectorHost %p', (host: unknown) => {
    expectError({ ...base, collectorHost: host }, 'collectorHost');
  });

  it('trims and lowercases a valid host', () => {
    const result: ConfigResult = readConfig({ ...base, collectorHost: '  Collector.Example.COM ' });
    expect(result.ok && result.config.collectorHost).toBe('collector.example.com');
  });

  it.each([undefined, '', 'CONSENTED', 'opt-in'])('rejects consentMode %p', (mode: unknown) => {
    expectError({ ...base, consentMode: mode }, 'consentMode');
  });

  it.each(['-', '2', '2-5', '2-5-', 'a1-b2'])('accepts pmcat %p', (pmcat: string) => {
    const result: ConfigResult = readConfig({ ...base, consentMode: 'pmcat', pmcat });
    expect(result.ok && result.config.pmcat).toBe(pmcat);
  });

  it.each([undefined, '', '--', '2--5', '2,5', '<x>'])('rejects pmcat %p in pmcat mode', (pmcat: unknown) => {
    expectError({ ...base, consentMode: 'pmcat', pmcat }, 'pmcat');
  });

  it('ignores pmcat outside pmcat mode', () => {
    const result: ConfigResult = readConfig({ ...base, pmcat: 'garbage!' });
    expect(result.ok && result.config.pmcat).toBe('');
  });

  it('falls back to defaults for unparseable booleans', () => {
    const result: ConfigResult = readConfig({ ...base, setUid: 'yes', trackDownloads: 0 });
    expect(result.ok && result.config.setUid).toBe(false);
    expect(result.ok && result.config.trackDownloads).toBe(true);
  });

  it('sanitises pathPrefix ("|" separates path levels)', () => {
    const result: ConfigResult = readConfig({ ...base, pathPrefix: ' my|intranet ' });
    expect(result.ok && result.config.pathPrefix).toBe('my-intranet');
    const empty: ConfigResult = readConfig({ ...base, pathPrefix: '   ' });
    expect(empty.ok && empty.config.pathPrefix).toBe('sharepoint');
  });
});

describe('isValidCollectorHost', () => {
  it('accepts single-label and multi-label hosts', () => {
    expect(isValidCollectorHost('localhost')).toBe(true);
    expect(isValidCollectorHost('a.b-c.example.com')).toBe(true);
  });
});
