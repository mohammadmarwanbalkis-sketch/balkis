/**
 * @balkis/cli — programmatic access to the CLI's building blocks:
 * module loading, graph/docs rendering, and the command dispatcher.
 */

export { type CliIO, runCli } from "./cli.js";
export { collectCalculations, loadRegistryFromModule } from "./load.js";
export { renderDocs, renderMermaid } from "./render.js";
