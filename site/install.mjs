/* The install block: the package managers, and a prompt to hand a coding agent. The landing
 * page and Getting started both show it. */
export const installTabs = [
  { label: "npm", lang: "sh", text: "npm install tweakit" },
  { label: "agent", lang: "text", text: `
    Install tweakit in this repo. Read https://ryankiley.github.io/tweakit/AGENTS.md first.
    Install it with this project's package manager, import "tweakit/css", and add one panel
    with a few controls to an existing component so I can tune it live. Bind the values to
    its styles. Verify the build.` },
  { label: "pnpm", lang: "sh", text: "pnpm add tweakit" },
  { label: "yarn", lang: "sh", text: "yarn add tweakit" },
  { label: "bun", lang: "sh", text: "bun add tweakit" },
];
