/**
 * Mirrors the SDKs' Params builder (eanalytics-react-native
 * src/models/classes/params.ts): a plain { key: value } object used for
 * action params and search params.
 */
export class Params {
  private readonly json: Record<string, unknown>;

  public constructor(json: Record<string, unknown>) {
    this.json = json;
  }

  public getJson(): Record<string, unknown> {
    return this.json;
  }
}

export class ParamsBuilder {
  private readonly mainJson: Record<string, unknown> = {};

  public addParam(key: string, value: unknown): ParamsBuilder {
    this.mainJson[key] = value;
    return this;
  }

  public build(): Params {
    // Copy so later addParam() calls don't mutate an already built Params.
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(this.mainJson)) copy[key] = this.mainJson[key];
    return new Params(copy);
  }
}
