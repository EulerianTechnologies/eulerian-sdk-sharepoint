import { consentFields } from '../../extensions/eulerianTracking/lib/consent';

describe('consentFields', () => {
  it('pmcat mode sends the configured refused categories', () => {
    expect(consentFields({ consentMode: 'pmcat', pmcat: '2-5' })).toEqual({ pmcat: '2-5' });
  });

  it('pmcat mode with "-" (everything accepted)', () => {
    expect(consentFields({ consentMode: 'pmcat', pmcat: '-' })).toEqual({ pmcat: '-' });
  });

  it('consented mode sends enoepm=1', () => {
    expect(consentFields({ consentMode: 'consented', pmcat: '' })).toEqual({ enoepm: '1' });
  });

  it('nonconsented mode sends enoepm=0', () => {
    expect(consentFields({ consentMode: 'nonconsented', pmcat: '' })).toEqual({ enoepm: '0' });
  });

  it('never mixes pmcat and enoepm', () => {
    expect(consentFields({ consentMode: 'consented', pmcat: '2-5' })).toEqual({ enoepm: '1' });
  });
});
