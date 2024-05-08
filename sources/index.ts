import type { Plugin } from "@yarnpkg/core";
import version from "./commands/version";

const plugin: Plugin = {
  commands: [version],
};

export default plugin;
