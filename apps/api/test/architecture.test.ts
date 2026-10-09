import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";

it("keeps business services and repositories independent of HTTP and startup I/O", async () => {
  const root = new URL("../src/modules/", import.meta.url);
  for (const feature of await readdir(root)) {
    for (const file of await readdir(new URL(`${feature}/`, root))) {
      if (!/^(service|repository)\.ts$/.test(file)) continue;
      const source = await readFile(new URL(`${feature}/${file}`, root), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      expect(imports, `${feature}/${file}`).not.toContain("express");
      expect(imports.some((path) => /http\/|infrastructure\/|node:fs|controller|app\.js|server\.js/.test(path))).toBe(false);
      expect(source).not.toMatch(/\b(?:Request|Response|statusCode)\b/);
      if (file === "service.ts") expect(source).not.toMatch(/\b(?:SELECT|INSERT|CREATE TABLE)\b/);
    }
  }
});
