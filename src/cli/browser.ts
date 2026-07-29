import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

interface CamoufoxPackage {
  bin: string | Record<string, string>;
}

function selectBin(bin: CamoufoxPackage["bin"]): string {
  if (typeof bin === "string") return bin;
  const executable = bin["camoufox-js"] ?? Object.values(bin)[0];
  if (!executable) throw new Error("camoufox-js does not declare an executable");
  return executable;
}

export async function runCamoufoxCommand(args: string[]): Promise<number> {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("camoufox-js/package.json");
  const packageJson = JSON.parse(
    await readFile(packagePath, "utf8"),
  ) as CamoufoxPackage;
  const executable = resolve(dirname(packagePath), selectBin(packageJson.bin));

  return await new Promise<number>((resolveStatus, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveStatus(code ?? 1));
  });
}
