import type { Workspace } from "@yarnpkg/core";
import { MessageName, execUtils } from "@yarnpkg/core";

export const execCommand = async (
  workspace: Workspace,
  commandAndArgs: string[] = []
): ReturnType<typeof execUtils.execvp> => {
  try {
    const [command, ...args] = commandAndArgs;
    return await execUtils.execvp(command, args, {
      cwd: workspace.cwd,
      strict: true,
    });
  } catch (error) {
    if (error instanceof execUtils.ExecError) {
      const execError = error;
      const reportExtraOriginal = error.reportExtra;
      error.reportExtra = (report) => {
        report.reportError(
          MessageName.EXCEPTION,
          `Command failed: ${commandAndArgs.join(" ")}`
        );
        report.reportError(
          MessageName.EXCEPTION,
          `stdout: ${execError.stdout.toString().trim()}`
        );
        report.reportError(
          MessageName.EXCEPTION,
          `stderr: ${execError.stderr.toString().trim()}`
        );
        if (reportExtraOriginal) reportExtraOriginal(report);
      };
    }
    throw error;
  }
};
