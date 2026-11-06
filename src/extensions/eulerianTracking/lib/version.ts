/**
 * Version of this extension, sent on every hit as `ea-sharepoint-sdk`.
 * Must equal package.json "version": `npm run version:check` (run in CI and
 * before every release) fails if they differ.
 */
export const SDK_VERSION: string = '0.1.0';

/** Sent on every hit as `ereplay-platform`, to identify SharePoint traffic. */
export const PLATFORM: string = 'sharepoint';
