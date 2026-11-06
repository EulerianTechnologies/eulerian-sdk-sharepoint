import { Params } from './params';

/**
 * Mirrors the SDKs' Action builder (eanalytics-react-native
 * src/models/classes/action.ts). Serialises to
 * { name, label, mode, ref, params: { key: value } }, with only the keys set.
 */
export class Action {
  private readonly json: Record<string, unknown>;

  public constructor(json: Record<string, unknown>) {
    this.json = json;
  }

  public getJson(): Record<string, unknown> {
    return this.json;
  }
}

export class ActionBuilder {
  private readonly mainJson: Record<string, unknown> = {};

  public setName(name: string): ActionBuilder {
    this.mainJson.name = name;
    return this;
  }

  public setLabel(label: string): ActionBuilder {
    this.mainJson.label = label;
    return this;
  }

  public setMode(mode: string): ActionBuilder {
    this.mainJson.mode = mode;
    return this;
  }

  public setReference(ref: string): ActionBuilder {
    this.mainJson.ref = ref;
    return this;
  }

  public setParams(params: Params): ActionBuilder {
    this.mainJson.params = params.getJson();
    return this;
  }

  public build(): Action {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(this.mainJson)) copy[key] = this.mainJson[key];
    return new Action(copy);
  }
}
