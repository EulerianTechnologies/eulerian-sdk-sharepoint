import { Action } from './action';

/** One hit object, as sent inside the JSON array body. */
export type Hit = Record<string, unknown>;

/** Fields every hit carries, computed by the tracker (not by callers). */
export interface IHitInternals {
  euidl: string;
  url: string;
  /** Hit time in Unix seconds (`ereplay-time`). */
  time: number;
}

/**
 * Base tag builder, mirroring EaGeneric.Builder in eanalytics-react-native
 * (src/models/eaGeneric.ts).
 *
 * Like the SDK, it keeps three dictionaries and build() merges them flat, in
 * this order (later keys win):
 *   internals  : euidl, url, ereplay-time
 *   pages      : path, pagegroup, uid, email, rf, actions
 *   properties : anything passed to set(), ereplay-notag, search fields
 *
 * Every other builder (EASearchBuilder...) extends this one, so setUid() and
 * setEmailHash() exist on every tag type.
 */
export class EaGenericBuilder {
  protected readonly internals: Record<string, unknown> = {};
  protected readonly pages: Record<string, unknown> = {};
  protected readonly properties: Record<string, unknown> = {};

  public constructor(internals: IHitInternals, path?: string) {
    this.internals.euidl = internals.euidl;
    this.internals.url = internals.url;
    this.internals['ereplay-time'] = internals.time;
    if (path !== undefined && path !== null && path !== '') {
      // All four SDKs force a leading "/" on path; we do the same.
      this.pages.path = path.charAt(0) === '/' ? path : '/' + path;
    }
  }

  /** Free key/value, like the SDKs' .set(key, value). Used for consent fields. */
  public set(key: string, value: unknown): this {
    this.properties[key] = value;
    return this;
  }

  /** Event-only hit: does not count as a page view (SDKs' .setStandalone()). */
  public setStandalone(): this {
    this.properties['ereplay-notag'] = 1;
    return this;
  }

  public setPageGroup(group: string | undefined): this {
    if (group) this.pages.pagegroup = group;
    return this;
  }

  /** Customer ID (SDKs' .setUID()). Here: the Entra object ID. */
  public setUid(uid: string | undefined): this {
    if (uid) this.pages.uid = uid;
    return this;
  }

  /** Writes the already hashed email under `email` (SDKs' .setEmail()). */
  public setEmailHash(emailHash: string | undefined): this {
    if (emailHash) this.pages.email = emailHash;
    return this;
  }

  /** Referrer. Not part of the app SDKs (open question 3), sent as a flat key. */
  public setReferrer(referrer: string | undefined): this {
    if (referrer) this.pages.rf = referrer;
    return this;
  }

  /** Appends to the `actions` array (SDKs' .putAction()). */
  public putAction(action: Action): this {
    if (!action) return this;
    const actions: unknown[] = (this.pages.actions as unknown[]) || [];
    actions.push(action.getJson());
    this.pages.actions = actions;
    return this;
  }

  /** Flat merge internals -> pages -> properties, same as Helper.mergeProperties. */
  public build(): Hit {
    const merged: Hit = {};
    const sources: Record<string, unknown>[] = [this.internals, this.pages, this.properties];
    for (const source of sources) {
      for (const key of Object.keys(source)) merged[key] = source[key];
    }
    return merged;
  }
}
