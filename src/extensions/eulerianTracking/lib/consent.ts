import { ITrackingConfig } from './config';

/**
 * Consent fields added to every hit. Pure function of the admin config:
 * v1 has no CMP integration and no per-user consent UI (see README, "Consent modes").
 *
 * - pmcat        -> { pmcat: "<refused category IDs>" }  ("-" = all accepted)
 * - consented    -> { enoepm: "1" }  consent management disabled, all collected
 * - nonconsented -> { enoepm: "0" }  no consent
 */
export function consentFields(config: Pick<ITrackingConfig, 'consentMode' | 'pmcat'>): Record<string, string> {
  switch (config.consentMode) {
    case 'pmcat':
      return { pmcat: config.pmcat };
    case 'consented':
      return { enoepm: '1' };
    case 'nonconsented':
      return { enoepm: '0' };
    default:
      // Unreachable with a validated config; return nothing rather than throw.
      return {};
  }
}
