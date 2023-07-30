import type { Workspace } from '@yarnpkg/core';
import { UsageError } from 'clipanion';
import conventionalChangelogConventionalCommits from 'conventional-changelog-conventionalcommits';
import { dynamicRequire } from './dynamicRequire';

export type ConventionalCommitsConfig = any;

export const loadConventionalCommitConfig = async (
  rootWorkspace: Workspace,
  preset: string,
): Promise<ConventionalCommitsConfig> => {
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
