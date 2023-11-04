import type { Callback } from '@types/conventional-recommended-bump';
import type { Workspace } from '@yarnpkg/core';
import concat from 'concat-stream';
import conventionalChangelog from 'conventional-changelog-core';
import conventionalCommitsFilter from 'conventional-commits-filter';
import conventionalCommitsParser from 'conventional-commits-parser';
import gitRawCommits from 'git-raw-commits';
import type { ConventionalChangelogConfig } from './conventionalCommitConfigUtils';

// const gitRoot = await gitUtils.fetchRoot(
//   project.configuration.projectCwd,
// );
// const [latestTag] = await rootTagsPromise;
// const gitBase = await gitUtils.fetchBase(gitRoot, {
//   baseRefs: [latestTag],
// });
// const changedFiles = await gitUtils.fetchChangedFiles(gitRoot, {
//   base: gitBase.hash,
//   project,
// });
// console.log({ changedFiles });

export interface GetCommitsOptions {
  from: string;
  to?: string;
  format?: string;
  path?: string;
  ignoreChanges?: string[];
}

export const getParsedCommits = async (
  config: ConventionalChangelogConfig,
  gitRawCommitsOptions: GetCommitsOptions,
): Promise<conventionalCommitsParser.Commit[]> => {
  const parserOpts: conventionalCommitsParser.Options =
    config.recommendedBumpOpts?.parserOpts ?? config.parserOpts;

  if (!parserOpts) {
    throw new Error('Invalid parser options');
  }

  return new Promise((resolve) => {
    gitRawCommits({
      format: '%B%n-hash-%n%H',
      from: gitRawCommitsOptions.from,
      path: gitRawCommitsOptions.path,
      ...(gitRawCommitsOptions.ignoreChanges
        ? {
            _: gitRawCommitsOptions.ignoreChanges.map(
              (ignoreChange) => `:(exclude,glob)${ignoreChange}`,
            ),
          }
        : undefined),
    })
      .pipe(conventionalCommitsParser(parserOpts))
      .pipe(
        concat((data: any) => {
          // this filters reverted commits from the list
          const filteredCommits = conventionalCommitsFilter(data);
          resolve(filteredCommits);
        }),
      );
  });
};

const versions = ['major', 'minor', 'patch'];
export const recommendBump = (
  commits: conventionalCommitsParser.Commit[],
  config: ConventionalChangelogConfig,
): Callback.Recommendation => {
  const whatBump = config.recommendedBumpOpts.whatBump;
  let result = whatBump(commits);
  if (result?.level != null) {
    result.releaseType = versions[result.level];
  } else if (result == null) {
    result = {};
  }

  return result;
};

export const generateChangelog = async (
  config: ConventionalChangelogConfig,
  newVersion: string,
  newTag: string | null,
  {
    previousTag = '',
    verbose = false,
    tagPrefix = 'v',
    path = '',
    lernaPackage = '',
  } = {},
): Promise<string> => {
  let content = '';

  return new Promise((resolve, reject) => {
    const changelogStream = conventionalChangelog(
      {
        lernaPackage,
        debug: verbose
          ? console.info.bind(console, 'conventional-changelog')
          : undefined,
        config,
        tagPrefix,
        version: newVersion,
        currentTag: newTag === null ? undefined : newTag,
        // TODO config types
      },
      {
        version: newVersion,
        currentTag: newTag === null ? undefined : newTag,
        previousTag,
      },
      { merges: null, path },
    ).on('error', (err) => {
      reject(err);
    });

    changelogStream.on('data', (buffer) => {
      content += buffer.toString();
    });

    changelogStream.on('end', () => {
      resolve(content);
    });
  });
};

export { default as getGitSemverTags } from 'git-semver-tags';
