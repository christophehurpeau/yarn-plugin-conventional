import { execFileSync } from "child_process";
import { URL, fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

function executeCommand(
  command: string,
  args: string[],
  options: {
    cwd: URL;
  }
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync("yarn", [command, ...args], {
      cwd: fileURLToPath(options.cwd),
      stdio: "pipe",
    });
    return { exitCode: 0, stdout: stdout.toString("utf8"), stderr: "" };
  } catch (error: any) {
    if (error.status === undefined) {
      throw error;
    }

    return {
      exitCode: error.status,
      stdout: error.stdout.toString("utf8"),
      stderr: error.stderr.toString("utf8"),
    };
  }
}

const presetOption = [
  "--preset",
  fileURLToPath(
    new URL(
      "../../node_modules/conventional-changelog-conventionalcommits",
      import.meta.url
    )
  ),
];

describe("version", () => {
  it("should fail if package has no version", () => {
    const { exitCode, stdout, stderr } = executeCommand(
      "version",
      [...presetOption, "--dry-run"],
      {
        cwd: new URL("../__fixtures__/no-version", import.meta.url),
      }
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      'UsageError: package.json has no version in its manifest. For the first release, set to "1.0.0-pre" or "0.1.0-pre".'
    ); // replace with expected output
    expect(stderr).toBeFalsy();
  });

  it("should fail if --prerelease is passed", () => {
    const { exitCode, stdout, stderr } = executeCommand(
      "version",
      [...presetOption, "--prerelease=alpha", "--dry-run"],
      {
        cwd: new URL("../__fixtures__/basic", import.meta.url),
      }
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("prerelease is not supported yet."); // replace with expected output
    expect(stderr).toBeFalsy();
  });

  it("should pass with dry-run and force", () => {
    const { exitCode, stdout, stderr } = executeCommand(
      "version",
      [...presetOption, "--force=minor", "--dry-run"],
      {
        cwd: new URL("../__fixtures__/basic", import.meta.url),
      }
    );
    console.log(stdout);
    expect(stderr).toBeFalsy();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic: 1.0.0 -> 1.1.0"); // replace with expected output
  });
});
