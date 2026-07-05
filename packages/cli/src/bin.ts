#!/usr/bin/env node
import { runCli } from "./cli.js";

const exitCode = await runCli(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
process.exitCode = exitCode;
