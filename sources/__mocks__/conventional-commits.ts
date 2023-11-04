import { join } from 'path';
import semver from 'semver';

const { outputFile } = await jest.requireActual<any>('fs-extra/esm');

export const applyBuildMetadata = jest.fn().mockName('applyBuildMetadata');
export const recommendVersion = jest.fn().mockName('recommendVersion');
export const updateChangelog = jest.fn().mockName('updateChangelog');

applyBuildMetadata.mockImplementation((version, buildMetadata) => {
  if (buildMetadata) {
    return `${version}+${buildMetadata}`;
  }
  return version;
});

recommendVersion.mockImplementation((node) =>
  semver.inc(node.version, 'patch'),
);

updateChangelog.mockImplementation((pkg) => {
  const changelogPath = join(pkg.location, 'CHANGELOG.md');

  return outputFile(changelogPath, 'changelog', 'utf8').then(() => ({
    logPath: changelogPath,
    newEntry: pkg.version ? `${pkg.name} - ${pkg.version}` : pkg.name,
  }));
});
