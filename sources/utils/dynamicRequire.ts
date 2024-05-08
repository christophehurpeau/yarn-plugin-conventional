import type { Workspace } from "@yarnpkg/core";
import { miscUtils } from "@yarnpkg/core";
import { npath } from "@yarnpkg/fslib";

export function dynamicRequire<T>(
  workspace: Workspace,
  packageName: string
): Promise<T> {
  try {
    // Note: this doesn't work when using corepack
    return miscUtils.dynamicRequire(packageName);
  } catch (error) {
    try {
      const nodeModulesPath = npath.join(
        npath.fromPortablePath(workspace.cwd),
        "node_modules",
        packageName
      );
      return miscUtils.dynamicRequire(nodeModulesPath);
    } catch {
      throw error;
    }
  }
}
