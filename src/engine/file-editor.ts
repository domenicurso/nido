import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { FileEditor } from "../types.ts";

export function createFileEditor(): FileEditor {
  return {
    copyDir(from, to) {
      return copyRecursive(from, to);
    },
    mergeDir(from, to) {
      return copyRecursive(from, to);
    },
    async patchJson<T>(filePath: string, patcher: (json: T) => T) {
      const source = await readExisting(filePath, "{}\n");
      const parsed = JSON.parse(source) as T;
      const nextValue = patcher(parsed);
      await ensureParent(filePath);
      await writeFile(
        filePath,
        `${JSON.stringify(nextValue, null, 2)}\n`,
        "utf8",
      );
    },
    async patchText(filePath: string, patcher: (text: string) => string) {
      const source = await readExisting(filePath, "");
      const nextValue = patcher(source);
      await ensureParent(filePath);
      await writeFile(filePath, nextValue, "utf8");
    },
    async write(filePath: string, contents: string) {
      await ensureParent(filePath);
      await writeFile(filePath, contents, "utf8");
    },
  };
}

async function copyRecursive(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      await copyRecursive(sourcePath, targetPath);
      continue;
    }

    await ensureParent(targetPath);
    await copyFile(sourcePath, targetPath);
  }
}

async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readExisting(
  filePath: string,
  fallback: string,
): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return fallback;
    }

    throw error;
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}
