import { EaGenericBuilder, IHitInternals } from './ea-generic';
import { Params } from './params';

/**
 * Internal search tag, mirroring EASearch.Builder in eanalytics-react-native
 * (src/models/eaSearch.ts): FLAT keys isearchengine / isearchresults /
 * isearchparams.
 *
 * NOTE: the iOS, Android and Flutter SDKs nest these instead:
 *   "isearchengine": { "name": ..., "results": ..., "params": {...} }
 * The HANDOFF tie-break rule ("when in doubt, do what RN does") selects the
 * flat form. If Eulerian says the collector only reads the nested form,
 * switching is local to this file. See docs/eulerian-protocol.md.
 */
export class EASearchBuilder extends EaGenericBuilder {
  public constructor(internals: IHitInternals, path: string) {
    super(internals, path);
  }

  public setName(name: string): this {
    this.properties.isearchengine = name;
    return this;
  }

  public setResults(results: number): this {
    this.properties.isearchresults = results;
    return this;
  }

  public setParams(params: Params): this {
    this.properties.isearchparams = params.getJson();
    return this;
  }
}
