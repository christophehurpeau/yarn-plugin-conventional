import type { Workspace } from '@yarnpkg/core';
import { WorkspaceResolver } from '@yarnpkg/core';
import { UsageError } from 'clipanion';
import semver from 'semver';
import { getWorkspaceName } from './workspaceUtils';

export type BumpType = 'major' | 'minor' | 'patch';

// https://github.com/yarnpkg/berry/blob/506ded5f5f5a89553435940c74f1d857fd685a42/packages/plugin-version/sources/versionUtils.ts#L10
// Basically we only support auto-upgrading the ranges that are very simple (^x.y.z, ~x.y.z, >=x.y.z, and of course x.y.z)
const SUPPORTED_UPGRADE_REGEXP =
  // eslint-disable-next-line unicorn/better-regex -- note that autofix cause issues https://github.com/sindresorhus/eslint-plugin-unicorn/issues/1626
  /^(>=|[~^]|)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/;

export const calcBumpRange = (
  workspace: Workspace,
  range: string,
  newVersion: string,
): string => {
  if (range === '*') {
    return range;
  }

  let useWorkspaceProtocol = false;

  if (range.startsWith(WorkspaceResolver.protocol)) {
    const slicedRange = range.slice(WorkspaceResolver.protocol.length);

    // Workspaces referenced through their path never get upgraded ("workspace:packages/yarnpkg-core")
    if (slicedRange === workspace.relativeCwd) {
      return range;
    }

    if (slicedRange === '*') {
      return range;
    }

    range = slicedRange;
    useWorkspaceProtocol = true;
  }

  const parsed = SUPPORTED_UPGRADE_REGEXP.exec(range);
  if (!parsed) {
    const workspaceName = getWorkspaceName(workspace);
    throw new Error(`Couldn't bump range ${range} in ${workspaceName}`);
  }

  return `${useWorkspaceProtocol ? WorkspaceResolver.protocol : ''}${
    parsed[1]
  }${newVersion}`;
};

export const getHighestBumpType = (bumpTypes: BumpType[]): BumpType => {
  if (bumpTypes.includes('major')) {
    return 'major';
  }

  if (bumpTypes.includes('minor')) {
    return 'minor';
  }

  return 'patch';
};

export const calcBumpType = (
  bumpType: BumpType,
  maxBumpType: BumpType,
): BumpType => {
  if (maxBumpType === 'major') {
    return bumpType;
  }

  if (maxBumpType === 'minor') {
    return bumpType === 'major' || bumpType === 'minor' ? 'minor' : 'patch';
  }

  return 'patch';
};

const incVersion = (version: string, bumpType: BumpType): string | null => {
  // handle breaking of 0.x
  if (bumpType === 'major' && semver.major(version) === 0) {
    bumpType = 'minor';
  }
  return semver.inc(version, bumpType);
};

export const incrementVersion = (
  workspace: Workspace,
  currentVersion: string,
  bumpType: BumpType,
): string => {
  const newVersion = incVersion(currentVersion, bumpType);

  if (!newVersion) {
    throw new UsageError(
      `Could not determine next version for "${getWorkspaceName(
        workspace,
      )}" (currentVersion: ${currentVersion}, bumpType: ${bumpType}})`,
    );
  }

  return newVersion;
};

// const createPrerelease = (
//   version: string,
//   prereleaseType: ReleaseType,
//   prereleaseId: string,
// ) => {
//   return semver.inc(version, prereleaseType, prereleaseId);
// };
