import { ActionBuilder } from '../../extensions/eulerianTracking/lib/tags/action';
import { EaGenericBuilder, IHitInternals } from '../../extensions/eulerianTracking/lib/tags/ea-generic';
import { EASearchBuilder } from '../../extensions/eulerianTracking/lib/tags/ea-search';
import { ParamsBuilder } from '../../extensions/eulerianTracking/lib/tags/params';
import { SDK_VERSION } from '../../extensions/eulerianTracking/lib/version';

/*
 * Expected objects below are what eanalytics-react-native's builders produce
 * for the same calls (getJson() = flat merge of internals, pages, properties),
 * minus the app-only internals (eos, ehw, ea-appname, ...).
 */

const internals: IHitInternals = {
  euidl: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  url: 'https://contoso.example.com/sites/hr/SitePages/Home.aspx',
  time: 1767225600
};

describe('EaGenericBuilder', () => {
  it('page view: internals + path (leading "/" added like the SDKs) + pagegroup', () => {
    const hit = new EaGenericBuilder(internals, 'sharepoint|sites/hr|Home').setPageGroup('Human Resources').build();
    expect(hit).toEqual({
      euidl: internals.euidl,
      url: internals.url,
      'ereplay-time': 1767225600,
      'ereplay-platform': 'sharepoint',
      'ea-sharepoint-sdk': SDK_VERSION,
      path: '/sharepoint|sites/hr|Home',
      pagegroup: 'Human Resources'
    });
  });

  it('keeps an existing leading "/" and omits path when not given', () => {
    expect(new EaGenericBuilder(internals, '/a|b').build().path).toBe('/a|b');
    expect(new EaGenericBuilder(internals).build()).not.toHaveProperty('path');
  });

  it('setUid / setEmailHash write plain uid / email fields', () => {
    const hit = new EaGenericBuilder(internals, 'p').setUid('a1b2').setEmailHash('abc123').build();
    expect(hit.uid).toBe('a1b2');
    expect(hit.email).toBe('abc123');
  });

  it('ignores empty values like the SDK setters', () => {
    const hit = new EaGenericBuilder(internals, 'p').setUid('').setEmailHash(undefined).setPageGroup('').setReferrer('').build();
    expect(Object.keys(hit).sort()).toEqual(['ea-sharepoint-sdk', 'ereplay-platform', 'ereplay-time', 'euidl', 'path', 'url']);
  });

  it('set(key, value) adds free fields (consent goes through here)', () => {
    expect(new EaGenericBuilder(internals, 'p').set('pmcat', '-').build().pmcat).toBe('-');
    expect(new EaGenericBuilder(internals, 'p').set('enoepm', '1').build().enoepm).toBe('1');
  });

  it('properties overwrite pages which overwrite internals (mergeProperties order)', () => {
    const hit = new EaGenericBuilder(internals, 'p').set('url', 'overridden').set('path', 'custom').build();
    expect(hit.url).toBe('overridden');
    expect(hit.path).toBe('custom');
  });

  it('standalone download action, as with .setStandalone().putAction()', () => {
    const action = new ActionBuilder()
      .setName('download')
      .setLabel('Report.pdf')
      .setParams(new ParamsBuilder().addParam('ext', 'pdf').build())
      .build();
    const hit = new EaGenericBuilder(internals, 'p').setStandalone().putAction(action).build();
    expect(hit['ereplay-notag']).toBe(1);
    expect(hit.actions).toEqual([{ name: 'download', label: 'Report.pdf', params: { ext: 'pdf' } }]);
  });

  it('putAction appends', () => {
    const a = new ActionBuilder().setName('a').setMode('in').setReference('r1').build();
    const b = new ActionBuilder().setName('b').build();
    const hit = new EaGenericBuilder(internals).putAction(a).putAction(b).build();
    expect(hit.actions).toEqual([{ name: 'a', mode: 'in', ref: 'r1' }, { name: 'b' }]);
  });

  it('build() returns a new object each time', () => {
    const builder = new EaGenericBuilder(internals, 'p');
    const first = builder.build();
    first.path = 'mutated';
    expect(builder.build().path).toBe('/p');
  });
});

describe('traffic identification', () => {
  it('every builder sets ereplay-platform=sharepoint and ea-sharepoint-sdk=<version>', () => {
    for (const hit of [new EaGenericBuilder(internals).build(), new EASearchBuilder(internals, 'p').build()]) {
      expect(hit['ereplay-platform']).toBe('sharepoint');
      expect(hit['ea-sharepoint-sdk']).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('EASearchBuilder', () => {
  it('nested isearchengine object, as in the iOS/Android/Flutter SDKs', () => {
    const hit = new EASearchBuilder(internals, 'sharepoint|root|search')
      .setName('sharepoint_search')
      .setResults(12)
      .setParams(new ParamsBuilder().addParam('keyword', 'holidays').build())
      .setUid('a1b2')
      .setEmailHash('abc')
      .build();
    expect(hit).toEqual({
      euidl: internals.euidl,
      url: internals.url,
      'ereplay-time': 1767225600,
      'ereplay-platform': 'sharepoint',
      'ea-sharepoint-sdk': SDK_VERSION,
      path: '/sharepoint|root|search',
      uid: 'a1b2',
      email: 'abc',
      isearchengine: { name: 'sharepoint_search', results: 12, params: { keyword: 'holidays' } }
    });
    expect(hit).not.toHaveProperty('isearchresults');
    expect(hit).not.toHaveProperty('isearchparams');
  });

  it('omits results/params when not set, and snapshots the engine at build()', () => {
    const builder = new EASearchBuilder(internals, 'p').setName('sharepoint_search');
    const first = builder.build();
    builder.setResults(3);
    expect(first.isearchengine).toEqual({ name: 'sharepoint_search' });
    expect(builder.build().isearchengine).toEqual({ name: 'sharepoint_search', results: 3 });
  });
});

describe('ParamsBuilder', () => {
  it('build() snapshots the params', () => {
    const builder = new ParamsBuilder().addParam('a', 1);
    const params = builder.build();
    builder.addParam('b', 2);
    expect(params.getJson()).toEqual({ a: 1 });
  });
});
