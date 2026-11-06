// Checks that package.json, config/package-solution.json (solution + every
// feature), src/.../lib/version.ts (sent in hits) and, when given, the Git tag
// all carry the same version.
//   node scripts/check-version.mjs            -> files agree with each other
//   node scripts/check-version.mjs v0.1.0     -> ...and with the tag
// In GitHub Actions the tag defaults to GITHUB_REF_NAME when it starts with "v".
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const solution = JSON.parse(readFileSync(new URL('../config/package-solution.json', import.meta.url), 'utf8')).solution;

// SharePoint versions have four parts; the npm/Git version has three.
const expected = `${pkg.version}.0`;
const errors = [];
if (solution.version !== expected) errors.push(`solution.version is ${solution.version}, expected ${expected}`);
for (const feature of solution.features || []) {
  if (feature.version !== expected) errors.push(`feature "${feature.title}" version is ${feature.version}, expected ${expected}`);
}

// The version sent in hits (ea-sharepoint-sdk) lives in lib/version.ts.
const versionTs = readFileSync(new URL('../src/extensions/eulerianTracking/lib/version.ts', import.meta.url), 'utf8');
const sdkVersion = (/SDK_VERSION: string = '([^']+)'/.exec(versionTs) || [])[1];
if (sdkVersion !== pkg.version) errors.push(`lib/version.ts SDK_VERSION is ${sdkVersion}, expected ${pkg.version}`);

const envTag = (process.env.GITHUB_REF_NAME || '').startsWith('v') ? process.env.GITHUB_REF_NAME : undefined;
const tag = process.argv[2] || envTag;
if (tag && tag !== `v${pkg.version}`) errors.push(`tag ${tag} does not match package.json version v${pkg.version}`);

if (errors.length) {
  console.error('Version mismatch:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`Versions OK: ${pkg.version} (sppkg ${expected})${tag ? `, tag ${tag}` : ''}`);
