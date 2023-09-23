/* eslint-disable max-lines */
/* eslint-disable complexity */
/* eslint-disable unicorn/no-array-method-this-argument */

import path from 'node:path';
import { BaseCommand, WorkspaceRequiredError } from '@yarnpkg/cli';
import {
  Cache,
  Configuration,
  MessageName,
  Project,
  StreamReport,
  scriptUtils,
  semverUtils,
  structUtils,
} from '@yarnpkg/core';
import type {
  Workspace,
  AllDependencies as DependencyType,
  Descriptor,
} from '@yarnpkg/core';
import { npath } from '@yarnpkg/fslib';
import type { Usage } from 'clipanion';
import { Command, Option, UsageError } from 'clipanion';
import * as t from 'typanion';
import type { BumpType } from '../utils/bumpTypeUtils';
import {
  calcBumpRange,
  calcBumpType,
  getHighestBumpType,
  incrementVersion,
} from '../utils/bumpTypeUtils';
import {
  getCommits,
  getGitSemverTags,
  recommendBump,
  generateChangelog,
} from '../utils/conventionalChangelogUtils';
import { loadConventionalCommitConfig } from '../utils/conventionalCommitConfigUtils';
import {
  createGitCommit,
  createGitTag,
  getDirtyFiles,
  getGitCurrentBranch,
  isBehindRemote,
  pushCommitsAndTags,
} from '../utils/gitUtils';
import {
  createGitHubClient,
  createGitRelease,
  parseGithubRepoUrl,
} from '../utils/githubUtils';
import { updateChangelogFile } from '../utils/updateChangelog';
import {
  buildDependenciesMaps,
  buildTopologicalOrderBatches,
  getWorkspaceName,
} from '../utils/workspaceUtils';

interface ChangedWorkspace {
  bumpReason?: string;
  bumpType: BumpType;
}

interface BumpedWorkspace extends ChangedWorkspace {
  hasChanged: boolean;
  currentVersion: string;
  newVersion: string;
  newTag: string | null;
  // for legacy configuration not using workspaces ranges https://yarnpkg.com/features/workspaces#workspace-ranges-workspace
  dependenciesToBump: [DependencyType, Descriptor, string][];
}

export default class VersionCommand extends BaseCommand {
  static paths = [['version']];

  static usage: Usage = Command.Usage({
    category: 'Conventional Version commands',
    description: 'Bump package version using conventional commit',
  });

  includesRoot = Option.Boolean('--includes-root', false, {
    description: 'Release root workspace [untested]',
  });

  dryRun = Option.Boolean('--dry-run', false, {
    description:
      'Print the versions without actually generating the package archive',
  });

  force = Option.String<BumpType>('--force', {
    description: 'Specify the release type',
    validator: t.isEnum(['major', 'minor', 'patch']),
  });

  prerelease = Option.String('--prerelease', {
    description: 'Add a prerelease identifier to new versions',
    tolerateBoolean: true,
  });

  json = Option.Boolean('--json', false, {
    description: 'Format the output as an NDJSON stream',
  });

  verbose = Option.Boolean('-v,--verbose', false, {});

  preset = Option.String(
    '--preset',
    'conventional-changelog-conventionalcommits',
    {
      description:
        'Conventional Changelog preset to require. Defaults to conventional-changelog-conventionalcommits.',
    },
  );

  tagPrefix = Option.String('--tag-version-prefix', 'v', {
    description: 'Defaults vo "v"',
  });

  changelogFile = Option.String('--changelog', 'CHANGELOG.md', {
    description: 'Changelog path. Default to CHANGELOG.md.',
  });

  commitMessage = Option.String('-m,--commit-message', 'chore: release\n\n%t', {
    description:
      'Commit message. Default to "chore: release %a". You can use %v for the version, %s for the version with prefix, %t to list tags, %a for auto best display.',
  });

  createRelease = Option.String('--create-release', {
    description: 'Create a release',
    validator: t.isEnum(['github']),
  });

  bumpDependentsHighestAs = Option.String<BumpType>(
    '--bump-dependents-highest-as',
    'major',
    {
      description: 'Bump dependents highest version as major, minor or patch',
      validator: t.isEnum(['major', 'minor', 'patch']),
    },
  );

  alwaysBumpPeerDependencies = Option.Boolean(
    '--always-bump-peer-dependencies',
    false,
    {
      description:
        "Always bump peer dependencies. Default to bumping only if the version doesn't satisfies the peer dependency range.",
    },
  );

  gitRemote = Option.String('--git-remote', 'origin', {
    description: 'Git remote to push commits and tags to',
  });

  // yes = Option.Boolean('-y,--yes', !!process.env.CI, {
  //   description: 'Skip all confirmations',
  // });

  async execute(): Promise<number> {
    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins,
    );
    const [cache, { project, workspace: cwdWorkspace }] = await Promise.all([
      Cache.find(configuration),
      Project.find(configuration, this.context.cwd),
    ]);

    if (!cwdWorkspace) {
      throw new WorkspaceRequiredError(project.cwd, this.context.cwd);
    }

    if (!this.dryRun) {
      const dirtyFiles = await getDirtyFiles(cwdWorkspace);
      if (dirtyFiles) {
        throw new Error(
          `Dirty Files:\n${dirtyFiles}\n\nThere are uncommitted changes in the git repository. Please commit or stash them first.`,
        );
      }
    }

    // Certain project fields (e.g. storedPackages) can only be accessed after
    // restoring the install state of the project.
    await project.restoreInstallState({
      restoreResolutions: false,
    });

    const rootWorkspace = project.topLevelWorkspace;
    const rootWorkspaceChildren = rootWorkspace.getRecursiveWorkspaceChildren();
    let rootNewVersion = '';
    let rootNewTag = '';
    const isMonorepo = rootWorkspaceChildren.length > 0;
    const isMonorepoVersionIndependent =
      isMonorepo && !rootWorkspace.manifest.version;
    const workspaces =
      !isMonorepo || this.includesRoot
        ? [rootWorkspace, ...rootWorkspaceChildren]
        : rootWorkspaceChildren;

    if (this.prerelease) {
      throw new UsageError('--prerelease is not supported yet.');
    }

    const rootTagsPromise = this.force
      ? null
      : getGitSemverTags({
          lernaTags: false,
          tagPrefix: this.tagPrefix,
          skipUnstable: true,
        });

    const [
      conventionalCommitConfig,
      githubClient,
      parsedRepoUrl,
      gitCurrentBranch,
    ] = await Promise.all([
      loadConventionalCommitConfig(rootWorkspace, this.preset),
      // create client early to fail fast if necessary
      this.createRelease ? createGitHubClient(rootWorkspace) : undefined,
      this.createRelease ? parseGithubRepoUrl(rootWorkspace) : undefined,
      getGitCurrentBranch(rootWorkspace),
    ]);

    const buildTagName = (workspace: Workspace, version: string): string =>
      `${
        isMonorepo && workspace !== rootWorkspace
          ? `${getWorkspaceName(workspace)}@`
          : this.tagPrefix
      }${version}`;

    const applyReport = await StreamReport.start(
      {
        configuration,
        json: this.json,
        stdout: this.context.stdout,
      },
      async (report): Promise<number> => {
        const changedWorkspaces = new Map<Workspace, ChangedWorkspace>();
        const previousTags = new Map<Workspace, string>();
        const dependenciesMap = isMonorepo
          ? buildDependenciesMaps(project)
          : null;

        report.reportInfo(MessageName.UNNAMED, 'Finding changed workspaces');

        // find changed workspaces

        for (const workspace of workspaces) {
          const workspaceName = getWorkspaceName(workspace);
          const isRoot = workspace === rootWorkspace;
          const version = workspace.manifest.version;

          if (isRoot && isMonorepo) {
            continue;
          }

          if (!version || version === '0.0.0') {
            if (
              (isRoot || isMonorepoVersionIndependent) &&
              (!isMonorepo || !isMonorepoVersionIndependent)
            ) {
              throw new UsageError(
                'package.json has no version in its manifest. For the first release, set to "1.0.0-pre" or "0.1.0-pre".',
              );
            }

            report.reportInfo(
              MessageName.UNNAMED,
              `${workspaceName}: skipped (no version)`,
            );
            continue;
          }

          const packageOption =
            isMonorepo && isMonorepoVersionIndependent
              ? workspaceName
              : undefined;

          const tags = await (isRoot || !isMonorepoVersionIndependent
            ? rootTagsPromise
            : getGitSemverTags({
                lernaTags: !!packageOption,
                package: packageOption,
                tagPrefix: this.tagPrefix,
                skipUnstable: true,
              }));

          const previousTag = tags?.[0] || '';
          previousTags.set(workspace, previousTag);

          let bumpType: BumpType | null = null;
          let bumpReason: string | undefined;

          if (this.force) {
            bumpType = this.force;
            bumpReason = 'forced by --force flag';
          } else if (version) {
            const workspaceRelativePath = path.relative(
              rootWorkspace.cwd,
              workspace.cwd,
            );

            const commits = await getCommits(conventionalCommitConfig, {
              format: '%B%n-hash-%n%H',
              from: previousTag,
              path: workspaceRelativePath,
            });

            // No changes found for this package
            if (commits.length === 0) {
              report.reportInfo(
                MessageName.UNNAMED,
                `${workspaceName}: skipped (no changes)`,
              );
              continue;
            }

            const { releaseType, reason } = recommendBump(
              commits,
              conventionalCommitConfig,
            );
            bumpReason = reason;

            if (releaseType) {
              bumpType = releaseType;
            }
          }

          if (bumpType) {
            if (isMonorepo && !workspace.manifest.name) {
              throw new Error('Workspace name is required');
            }

            const currentVersion = workspace.manifest.version;

            if (!currentVersion) {
              throw new UsageError(
                `Invalid "${getWorkspaceName(workspace)}" version`,
              );
            }

            changedWorkspaces.set(workspace, {
              bumpType,
              bumpReason,
            });
          }
        }

        if (changedWorkspaces.size === 0) {
          report.reportInfo(MessageName.UNNAMED, 'No changed workspaces');
          return 0;
        }

        report.reportInfo(MessageName.UNNAMED, 'Preparing bumping');

        const bumpedWorkspaces = new Map<Workspace, BumpedWorkspace>();
        const batches = dependenciesMap
          ? buildTopologicalOrderBatches(project, dependenciesMap)
          : [[rootWorkspace]];

        for (const batch of batches) {
          for (const workspace of batch) {
            const currentVersion = workspace.manifest.version;

            if (!currentVersion && !workspace.manifest.private) {
              throw new UsageError(
                `Invalid "${getWorkspaceName(workspace)}" version`,
              );
            }

            const changedWorkspace = changedWorkspaces.get(workspace);
            let bumpType: BumpType | null = null;
            const bumpReasons: string[] = [];
            const dependenciesToBump: BumpedWorkspace['dependenciesToBump'] =
              [];

            if (changedWorkspace) {
              bumpType = changedWorkspace.bumpType;
              bumpReasons.push(changedWorkspace.bumpReason || 'by commits');
            }

            const dependencies = dependenciesMap?.get(workspace);

            if (dependencies) {
              for (const [
                dependencyWorkspace,
                dependencyType,
                dependencyDescriptor,
              ] of dependencies) {
                const dependencyBumpedWorkspace =
                  bumpedWorkspaces.get(dependencyWorkspace);

                if (!dependencyBumpedWorkspace) {
                  continue;
                }

                if (
                  dependencyType === 'peerDependencies' &&
                  !this.alwaysBumpPeerDependencies &&
                  // skip when peerdependency with a new version satisfied by the existing range.
                  semverUtils.satisfiesWithPrereleases(
                    dependencyBumpedWorkspace.newVersion,
                    dependencyDescriptor.range,
                  )
                ) {
                  continue;
                }

                const newRange = calcBumpRange(
                  workspace,
                  dependencyDescriptor.range,
                  dependencyBumpedWorkspace.newVersion,
                );

                if (dependencyDescriptor.range === newRange) {
                  continue;
                }

                dependenciesToBump.push([
                  dependencyType,
                  dependencyDescriptor,
                  newRange,
                ]);

                bumpType = getHighestBumpType([
                  bumpType ?? 'patch',
                  calcBumpType(
                    dependencyBumpedWorkspace.bumpType,
                    this.bumpDependentsHighestAs,
                  ),
                ]);

                bumpReasons.push(
                  `Version bump for dependency: ${dependencyDescriptor.name}`,
                );
              }
            }

            const workspaceName = getWorkspaceName(workspace);
            if (!currentVersion) {
              report.reportInfo(
                MessageName.UNNAMED,
                `${workspaceName}: skipped (no version)`,
              );
            } else if (!bumpType) {
              if (
                isMonorepo &&
                !isMonorepoVersionIndependent &&
                workspace === rootWorkspace
              ) {
                report.reportInfo(
                  MessageName.UNNAMED,
                  `${workspaceName}: skipped (${
                    changedWorkspace
                      ? `no bump recommended by ${this.preset}`
                      : 'no changes'
                  })`,
                );
              }
            } else {
              const newVersion = incrementVersion(
                workspace,
                currentVersion,
                bumpType,
              );

              const tagName = buildTagName(workspace, newVersion);

              if (workspace === rootWorkspace) {
                rootNewVersion = newVersion;
                rootNewTag = tagName;
              }

              if (workspace !== rootWorkspace || !isMonorepo) {
                const bumpReason = bumpReasons.join('\n');
                bumpedWorkspaces.set(workspace, {
                  currentVersion,
                  bumpType,
                  bumpReason,
                  newVersion,
                  newTag: tagName,
                  hasChanged: changedWorkspace !== undefined,
                  dependenciesToBump,
                });

                report.reportInfo(
                  MessageName.UNNAMED,
                  `${workspaceName}: ${currentVersion} -> ${
                    !isMonorepo || isMonorepoVersionIndependent
                      ? newVersion
                      : 'bump'
                  } (${bumpReason.replace('\n', ' ; ')})`,
                );
                report.reportJson({
                  cwd: npath.fromPortablePath(workspace.cwd),
                  ident: workspaceName,
                  oldVersion: currentVersion,
                  ...(isMonorepoVersionIndependent ? { newVersion } : {}),
                  bumpType,
                  bumpReasons,
                });
              }
            }
          }
        }

        // TODO ask for confirmation
        // if (!this.yes) {
        // }

        // TODO do this entire phase here, not override for not independent only
        if (isMonorepo && !isMonorepoVersionIndependent) {
          const currentVersion = rootWorkspace.manifest.version!;
          const highestBumpType = getHighestBumpType(
            [...bumpedWorkspaces.values()].map(({ bumpType }) => bumpType),
          );
          const newVersion = incrementVersion(
            rootWorkspace,
            currentVersion,
            highestBumpType,
          );
          rootNewVersion = newVersion;
          rootNewTag = buildTagName(rootWorkspace, newVersion);

          [...bumpedWorkspaces.entries()].forEach(
            ([workspace, bumpedWorkspace]) => {
              const isRoot = workspace === rootWorkspace;
              if (isRoot) {
                throw new Error('Unexpected root found in bumped workspaces');
              }
              bumpedWorkspace.bumpType = highestBumpType;
              bumpedWorkspace.newVersion = newVersion;
              bumpedWorkspace.newTag = isRoot ? rootNewTag : null;
            },
          );

          bumpedWorkspaces.set(rootWorkspace, {
            currentVersion,
            bumpType: highestBumpType,
            hasChanged: true,
            newVersion: rootNewVersion,
            newTag: rootNewTag,
            dependenciesToBump: [],
          });

          report.reportInfo(
            MessageName.UNNAMED,
            `${currentVersion} -> ${newVersion}`,
          );
          report.reportJson({
            oldVersion: currentVersion,
            newVersion,
          });
        }

        // do modifications

        if (isMonorepoVersionIndependent) {
          await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
            rootWorkspace,
            'preversion',
            { cwd: rootWorkspace.cwd, report },
          );
        }

        await Promise.all(
          [...bumpedWorkspaces.entries()].map(
            async ([workspace, { newVersion, dependenciesToBump }]) => {
              if (!this.dryRun) {
                await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
                  workspace,
                  'preversion',
                  { cwd: workspace.cwd, report },
                );

                workspace.manifest.version = newVersion;

                for (const [
                  dependencyType,
                  dependencyDescriptor,
                  dependencyNewRange,
                ] of dependenciesToBump) {
                  const newDescriptor = structUtils.makeDescriptor(
                    dependencyDescriptor,
                    dependencyNewRange,
                  );
                  workspace.manifest[dependencyType].set(
                    dependencyDescriptor.identHash,
                    newDescriptor,
                  );
                }

                await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
                  workspace,
                  'version',
                  { cwd: workspace.cwd, report },
                );
              }
            },
          ),
        );

        if (isMonorepoVersionIndependent) {
          await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
            rootWorkspace,
            'version',
            { cwd: rootWorkspace.cwd, report },
          );
        }

        const changelogs = new Map<Workspace, string>();

        await Promise.all(
          [...bumpedWorkspaces.entries()].map(
            async ([
              workspace,
              { newVersion, newTag, hasChanged, bumpReason },
            ]) => {
              const workspaceRelativePath =
                rootWorkspace === workspace
                  ? undefined
                  : path.relative(rootWorkspace.cwd, workspace.cwd);

              // TODO this command looks for commits again, we should reuse the ones we already have
              let changelog = await generateChangelog(
                conventionalCommitConfig,
                newVersion,
                newTag,
                {
                  lernaPackage:
                    rootWorkspace === workspace || !isMonorepoVersionIndependent
                      ? undefined
                      : getWorkspaceName(workspace),
                  path: workspaceRelativePath,
                  previousTag: previousTags.get(workspace),
                  verbose: this.verbose,
                  tagPrefix: this.tagPrefix,
                },
              );

              if (!hasChanged && bumpReason && workspace !== rootWorkspace) {
                changelog += `${bumpReason}\n\n`;
              }

              if (
                changelog.slice(changelog.indexOf('\n')).trim().length === 0
              ) {
                changelog += 'Note: no notable changes\n\n';
              }

              changelogs.set(workspace, changelog);

              if (this.changelogFile) {
                if (this.dryRun) {
                  report.reportInfo(
                    MessageName.UNNAMED,
                    `${getWorkspaceName(workspace)}: ${
                      this.changelogFile
                    }\n${changelog}`,
                  );
                } else {
                  await updateChangelogFile(
                    changelog,
                    this.tagPrefix,
                    `${workspace.cwd}/${this.changelogFile}`,
                  );
                }
              }
            },
          ),
        );

        if (!this.dryRun) {
          report.reportSeparator();

          // install to update versions in lock file
          report.reportInfo(
            MessageName.UNNAMED,
            `${getWorkspaceName(rootWorkspace)}: Running install`,
          );
          await project.install({ cache, report });

          report.reportSeparator();
          report.reportInfo(MessageName.UNNAMED, 'Commit, tag and push');

          const tagsSet = new Set<string>(
            [...bumpedWorkspaces.values()]
              .map(({ newTag }) => newTag)
              .filter((newTag) => newTag !== null) as string[],
          );

          const tagsInCommitMessage = [...tagsSet]
            .map((tag) => `- ${tag}`)
            .join('\n');
          const message = this.commitMessage
            .replace(/\\n/g, '\n')
            .replace(
              /%a/g,
              isMonorepoVersionIndependent
                ? `\n\n${tagsInCommitMessage}`
                : rootNewVersion,
            )
            .replace(/%s/g, rootNewTag)
            .replace(/%v/g, rootNewVersion)
            .replace(/%t/g, tagsInCommitMessage);
          await createGitCommit(rootWorkspace, message);

          for (const [workspace, { newTag }] of bumpedWorkspaces.entries()) {
            if (newTag === null) continue;
            await createGitTag(workspace, newTag);
          }

          if (
            await isBehindRemote(
              rootWorkspace,
              this.gitRemote,
              gitCurrentBranch,
            )
          ) {
            report.reportInfo(MessageName.UNNAMED, 'Remote is ahead, aborting');
            return process.env.CI ? 0 : 1;
          }

          // run postversion
          await scriptUtils.maybeExecuteWorkspaceLifecycleScript(
            rootWorkspace,
            'postversion',
            { cwd: rootWorkspace.cwd, report },
          );

          await pushCommitsAndTags(
            rootWorkspace,
            this.gitRemote,
            gitCurrentBranch,
          );

          // TODO open github PR

          if (this.createRelease && githubClient && parsedRepoUrl) {
            report.reportInfo(MessageName.UNNAMED, 'Create git release');

            await Promise.all(
              [...bumpedWorkspaces.entries()].map(([workspace, { newTag }]) => {
                if (newTag === null) return;
                const changelog = changelogs.get(workspace);
                if (!changelog) {
                  report.reportWarning(
                    MessageName.UNNAMED,
                    `No changelog found for workspace: ${getWorkspaceName(
                      workspace,
                    )}`,
                  );
                  return;
                }
                return createGitRelease(
                  githubClient,
                  parsedRepoUrl,
                  newTag,
                  changelog,
                  !!this.prerelease,
                );
              }),
            );
          }
        }
        return 0;
      },
    );

    return applyReport.exitCode();
  }
}
