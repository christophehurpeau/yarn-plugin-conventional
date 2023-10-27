import { promisify } from 'node:util';
// import concat from 'concat-stream';
import type { Workspace } from '@yarnpkg/core';
import conventionalChangelog from 'conventional-changelog-core';
import conventionalCommitsFilter from 'conventional-commits-filter';
import conventionalCommitsParser from 'conventional-commits-parser';
import type { Callback } from '@types/conventional-recommended-bump';
import gitSemverTags from 'git-semver-tags';
import type { ConventionalCommitsConfig } from './conventionalCommitConfigUtils';
import type { GetCommitsOptions } from './gitUtils';
import { getCommits as getRawCommits } from './gitUtils';

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

export const getGitSemverTags = promisify(gitSemverTags);

export const getParsedCommits = async (
  workspace: Workspace,
  config: ConventionalCommitsConfig,
  gitRawCommitsOptions: GetCommitsOptions,
): Promise<conventionalCommitsParser.Commit[]> => {
  const parserOpts: conventionalCommitsParser.Options =
    config.recommendedBumpOpts?.parserOpts ?? config.parserOpts;

  if (!parserOpts) {
    throw new Error('Invalid parser options');
  }

  const commits = await getRawCommits(workspace, gitRawCommitsOptions);
  const parsedCommits = commits.map((commit) =>
    conventionalCommitsParser.sync(commit, parserOpts),
  );
  // this filters reverted commits from the list
  return conventionalCommitsFilter(parsedCommits);
};

const versions = ['major', 'minor', 'patch'];
export const recommendBump = (
  commits: conventionalCommitsParser.Commit[],
  config: ConventionalCommitsConfig,
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
  config: ConventionalCommitsConfig,
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
