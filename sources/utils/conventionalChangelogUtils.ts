import { promisify } from 'node:util';
import concat from 'concat-stream';
import conventionalChangelog from 'conventional-changelog-core';
import conventionalCommitsFilter from 'conventional-commits-filter';
import conventionalCommitsParser from 'conventional-commits-parser';
import type { Callback } from 'conventional-recommended-bump';
import gitRawCommits from 'git-raw-commits';
import gitSemverTags from 'git-semver-tags';
import type { ConventionalCommitsConfig } from './conventionalCommitConfigUtils';

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

export const getCommits = (
  config: ConventionalCommitsConfig,
  options: gitRawCommits.GitOptions,
): Promise<conventionalCommitsParser.Commit[]> => {
  const parserOpts: conventionalCommitsParser.Options =
    config.recommendedBumpOpts?.parserOpts ?? config.parserOpts;

  if (!parserOpts) {
    throw new Error('Invalid parser options');
  }

  return new Promise((resolve) => {
    // TODO use yarn to get commits, not this lib
    // TODO filter commits based on ignore paths
    // TODO filter commits based on dev dependencies modifications in package.json
    gitRawCommits(options)
      .pipe(conventionalCommitsParser(parserOpts))
      .pipe(
        concat((data: any) => {
          const filteredCommits = conventionalCommitsFilter(data);
          resolve(filteredCommits);
        }),
      );
  });
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
