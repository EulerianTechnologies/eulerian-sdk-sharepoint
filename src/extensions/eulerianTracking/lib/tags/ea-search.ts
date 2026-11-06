import { EaGenericBuilder, Hit, IHitInternals } from './ea-generic';
import { Params } from './params';

/**
 * Internal search tag, in the NESTED form used by the iOS, Android and
 * Flutter SDKs (EASearch.m, EASearch.java, Search.dart):
 *
 *   "isearchengine": { "name": "...", "results": 12, "params": { ... } }
 *
 * (eanalytics-react-native sends flat isearchengine / isearchresults /
 * isearchparams keys instead; the native SDKs' form was chosen.)
 */
export class EASearchBuilder extends EaGenericBuilder {
  private readonly engine: Record<string, unknown> = {};

  public constructor(internals: IHitInternals, path: string) {
    super(internals, path);
  }

  public setName(name: string): this {
    this.engine.name = name;
    return this;
  }

  public setResults(results: number): this {
    this.engine.results = results;
    return this;
  }

  public setParams(params: Params): this {
    this.engine.params = params.getJson();
    return this;
  }

  /** Adds the engine object (copied, so later setter calls don't alter built hits). */
  public build(): Hit {
    const hit: Hit = super.build();
    const engine: Record<string, unknown> = {};
    for (const key of Object.keys(this.engine)) engine[key] = this.engine[key];
    hit.isearchengine = engine;
    return hit;
  }
}
