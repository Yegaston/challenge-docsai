import { readFile } from "node:fs/promises";
import { evaluate } from "./evaluate.js";

async function main() {
  if (process.argv.length !== 5) throw new Error("Expected dataset, baseline and candidate paths");
  const artifacts = await Promise.all(process.argv.slice(2).map(async (path) => JSON.parse(await readFile(path, "utf8")) as unknown));
  process.stdout.write(`${JSON.stringify(evaluate(artifacts[0], artifacts[1], artifacts[2]), null, 2)}\n`);
}

main().catch(() => {
  process.stderr.write("Evaluation failed: check artifact paths, format, versions and fixture IDs.\n");
  process.exitCode = 1;
});
