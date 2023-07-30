import { execFileSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';

const yarnPath = fileURLToPath(
  new URL('../../.yarn/releases/yarn-3.6.1.cjs', import.meta.url),
);

async function executeCommand(
  command: string,
  args: string[],
  options: {
    cwd: URL;
  },
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const stdout = execFileSync(yarnPath, [command, ...args], {
      cwd: fileURLToPath(options.cwd),
      stdio: 'pipe',
    });
    return { exitCode: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (error: any) {
    if (error.status === undefined) {
      throw error;
    }
    return {
      exitCode: error.status,
      stdout: error.stdout.toString('utf8'),
      stderr: error.stderr.toString('utf8'),
    };
  }
}

describe('version', () => {
  it('should fail if package has no version', async () => {
    const { exitCode, stdout, stderr } = await executeCommand(
      'version',
      ['--dry-run'],
      {
        cwd: new URL('../__fixtures__/no-version', import.meta.url),
      },
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      'UsageError: package.json has no version in its manifest. For the first release, set to "1.0.0-pre" or "0.1.0-pre".',
    ); // replace with expected output
    expect(stderr).toBeFalsy();
  });

  it('should fail if monorepo with fixed version', async () => {
    const { exitCode, stdout, stderr } = await executeCommand(
      'version',
      ['--dry-run'],
      {
        cwd: new URL('../__fixtures__/monorepo', import.meta.url),
      },
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      'Monorepo with fixed version is not supported yet.',
    ); // replace with expected output
    expect(stderr).toBeFalsy();
  });

  it('should fail if --prerelease is passed', async () => {
    const { exitCode, stdout, stderr } = await executeCommand(
      'version',
      ['--prerelease=alpha', '--dry-run'],
      {
        cwd: new URL('../__fixtures__/basic', import.meta.url),
      },
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain('prerelease is not supported yet.'); // replace with expected output
    expect(stderr).toBeFalsy();
  });

  it('should pass with dry-run and force', async () => {
    const { exitCode, stdout, stderr } = await executeCommand(
      'version',
      ['--force=minor', '--dry-run'],
      {
        cwd: new URL('../__fixtures__/basic', import.meta.url),
      },
    );
    console.log(stdout);
    expect(stderr).toBeFalsy();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('basic: 1.0.0 -> 1.1.0'); // replace with expected output
  });
});
