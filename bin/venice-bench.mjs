#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const entry = path.join(root, "src", "cli.ts");

const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
});
child.on("exit", (code) => process.exit(code ?? 0));
