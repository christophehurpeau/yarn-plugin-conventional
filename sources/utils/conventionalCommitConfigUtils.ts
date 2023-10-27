import type { Workspace } from '@yarnpkg/core';
import { UsageError } from 'clipanion';
import conventionalChangelogConventionalCommits from 'conventional-changelog-conventionalcommits';
import type { Options as CoreOptions } from 'conventional-changelog-core';
import { dynamicRequire } from './dynamicRequire';

export type ConventionalChangelogConfig = CoreOptions.Config.Object;

export const loadConventionalCommitConfig = async (
  rootWorkspace: Workspace,
  preset: string,
): Promise<ConventionalChangelogConfig> => {
  try {
    const loadPreset = (): Promise<any> => {
      if (preset === 'conventional-changelog-conventionalcommits') {
        return Promise.resolve(conventionalChangelogConventionalCommits);
      }
      return dynamicRequire(rootWorkspace, preset);
    };

    const createConfig = await loadPreset();
    const config = await createConfig();
    return config;
  } catch (error: any) {
    throw new UsageError(
      `Failed to require preset "${preset}": ${error.message as string}`,
    );
  }
};
