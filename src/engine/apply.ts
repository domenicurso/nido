import { Eta } from "eta";
import { spawn } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ApplyOperation,
  CommandDefinition,
  CommandRunOptions,
  GenerationContext,
  GenerationResult,
  ModuleDefinition,
  PatchJsonOperation,
  PatchTextOperation,
  PromptAnswers,
  ResolvedSelection,
  TemplateDefinition,
  WriteOperation,
} from "../types.ts";

import { createFileEditor } from "./file-editor.ts";

const eta = new Eta({ autoEscape: false, useWith: true });

interface ApplyProjectInput {
  answers: PromptAnswers;
  cwd: string;
  onStep?: (message: string) => void;
  selection: ResolvedSelection;
}

interface RenderData {
  answers: Record<string, unknown>;
  autoAddedModuleIds: string[];
  modules: Array<{ id: string; label: string }>;
  projectName: string;
  targetDir: string;
  template: { id: string; label: string };
}

export async function applyProject({
  answers,
  cwd,
  onStep,
  selection,
}: ApplyProjectInput): Promise<GenerationResult> {
  const targetDir = path.resolve(cwd, answers.projectName);
  await assertTargetDirAvailable(targetDir);

  const ctx: GenerationContext = {
    answers: answers.values,
    autoAddedModuleIds: selection.autoAddedModuleIds,
    modules: selection.modules,
    projectName: answers.projectName,
    targetDir,
    template: selection.template,
  };

  const editor = createFileEditor();
  const renderData = createRenderData(ctx);

  onStep?.(`Creating ${selection.template.label}`);
  await runCommand(selection.template.generator, {
    cwd: path.dirname(targetDir),
    projectName: answers.projectName,
    targetDir,
  });
  await applyDefinition(selection.template, ctx, renderData, onStep);

  for (const module of selection.modules) {
    onStep?.(`Applying ${module.label}`);
    await applyDefinition(module, ctx, renderData, onStep);
  }

  let installRan = false;

  if (answers.values["global.installDeps"] === true) {
    onStep?.("Running bun install");
    await runCommand(
      {
        args: ["install"],
        command: "bun",
      },
      {
        cwd: targetDir,
        projectName: answers.projectName,
        targetDir,
      },
    );
    installRan = true;
  }

  return {
    installRan,
    nextSteps: buildNextSteps({
      installRan,
      projectName: answers.projectName,
      templateId: selection.template.id,
    }),
    targetDir,
  };

  async function applyDefinition(
    definition: TemplateDefinition | ModuleDefinition,
    innerCtx: GenerationContext,
    data: RenderData,
    reportStep?: (message: string) => void,
  ): Promise<void> {
    for (const operation of definition.apply) {
      if (!shouldApply(operation, data)) {
        continue;
      }

      reportStep?.(`${definition.label}: ${describeOperation(operation)}`);
      await applyOperation(
        operation,
        definition.directory,
        innerCtx.targetDir,
        editor,
        data,
      );
    }
  }
}

async function assertTargetDirAvailable(targetDir: string): Promise<void> {
  try {
    await access(targetDir);
  } catch {
    return;
  }

  const contents = await readdir(targetDir);

  if (contents.length > 0) {
    throw new Error(
      `Target directory "${targetDir}" already exists and is not empty.`,
    );
  }
}

async function runCommand(
  definition: CommandDefinition,
  options: CommandRunOptions,
): Promise<void> {
  const args = definition.args
    .map((arg) => renderString(arg, createCommandData(options)).trim())
    .filter((arg) => arg.length > 0);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(definition.command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim().length > 0
            ? stderr.trim()
            : `Command "${definition.command} ${args.join(" ")}" failed with exit code ${code}.`,
        ),
      );
    });
  });
}

async function applyOperation(
  operation: ApplyOperation,
  baseDir: string,
  targetDir: string,
  editor: ReturnType<typeof createFileEditor>,
  data: RenderData,
): Promise<void> {
  switch (operation.type) {
    case "mergeDir":
      await mergeRenderedDir({
        editor,
        fromDir: path.join(
          baseDir,
          renderString(operation.from ?? "files", data),
        ),
        targetDir: path.join(
          targetDir,
          renderString(operation.to ?? ".", data),
        ),
        data,
      });
      return;
    case "patchJson":
      await editor.patchJson<unknown>(
        path.join(targetDir, renderString(operation.path, data)),
        (json) => deepMerge(json, renderValue(operation.merge, data)),
      );
      return;
    case "patchText":
      await editor.patchText(
        path.join(targetDir, renderString(operation.path, data)),
        (text) => patchText(text, operation, data),
      );
      return;
    case "write":
      await editor.write(
        path.join(targetDir, renderString(operation.path, data)),
        await resolveWriteContents(operation, baseDir, data),
      );
      return;
  }
}

async function mergeRenderedDir({
  data,
  editor,
  fromDir,
  targetDir,
}: {
  data: RenderData;
  editor: ReturnType<typeof createFileEditor>;
  fromDir: string;
  targetDir: string;
}): Promise<void> {
  try {
    const entries = await readdir(fromDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(fromDir, entry.name);
      const renderedName = stripEtaExtension(renderString(entry.name, data));
      const targetPath = path.join(targetDir, renderedName);

      if (entry.isDirectory()) {
        await mergeRenderedDir({
          data,
          editor,
          fromDir: sourcePath,
          targetDir: targetPath,
        });
        continue;
      }

      const contents = await readFile(sourcePath, "utf8");
      const rendered = sourcePath.endsWith(".eta")
        ? renderString(contents, data)
        : contents;
      await editor.write(targetPath, rendered);
    }
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }

    throw error;
  }
}

async function resolveWriteContents(
  operation: WriteOperation,
  baseDir: string,
  data: RenderData,
): Promise<string> {
  if (operation.contents) {
    return renderString(operation.contents, data);
  }

  if (operation.template) {
    const templatePath = path.join(
      baseDir,
      renderString(operation.template, data),
    );
    const source = await readFile(templatePath, "utf8");
    return renderString(source, data);
  }

  throw new Error(
    `Write operation for "${operation.path}" must define template or contents.`,
  );
}

function patchText(
  source: string,
  operation: PatchTextOperation,
  data: RenderData,
): string {
  const skipIfContains = operation.skipIfContains
    ? renderString(operation.skipIfContains, data)
    : undefined;

  if (skipIfContains && source.includes(skipIfContains)) {
    return source;
  }

  let next = source;

  if (operation.find && operation.replace !== undefined) {
    next = next.replace(
      renderString(operation.find, data),
      renderString(operation.replace, data),
    );
  }

  if (operation.prepend) {
    const value = renderString(operation.prepend, data);
    next = next.startsWith(value) ? next : `${value}${next}`;
  }

  if (operation.append) {
    const value = renderString(operation.append, data);
    next = next.includes(value) ? next : `${next}${value}`;
  }

  return next;
}

function shouldApply(operation: ApplyOperation, data: RenderData): boolean {
  if (!operation.when) {
    return true;
  }

  const value = renderString(operation.when, data).trim().toLowerCase();
  return (
    value !== "" &&
    value !== "false" &&
    value !== "0" &&
    value !== "null" &&
    value !== "undefined"
  );
}

function describeOperation(operation: ApplyOperation): string {
  switch (operation.type) {
    case "mergeDir":
      return "merge files";
    case "patchJson":
      return `patch ${operation.path}`;
    case "patchText":
      return `patch ${operation.path}`;
    case "write":
      return `write ${operation.path}`;
  }
}

function createRenderData(ctx: GenerationContext): RenderData {
  return {
    answers: ctx.answers,
    autoAddedModuleIds: ctx.autoAddedModuleIds,
    modules: ctx.modules.map((module) => ({
      id: module.id,
      label: module.label,
    })),
    projectName: ctx.projectName,
    targetDir: ctx.targetDir,
    template: { id: ctx.template.id, label: ctx.template.label },
  };
}

function createCommandData(options: CommandRunOptions): RenderData {
  return {
    answers: {},
    autoAddedModuleIds: [],
    modules: [],
    projectName: options.projectName,
    targetDir: options.targetDir,
    template: { id: "", label: "" },
  };
}

function renderString(template: string, data: RenderData): string {
  return eta.renderString(template, data) ?? "";
}

function renderValue(value: unknown, data: RenderData): unknown {
  if (typeof value === "string") {
    return renderString(value, data);
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, data));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        renderValue(item, data),
      ]),
    );
  }

  return value;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(patch)) {
    return patch;
  }

  if (isRecord(base) && isRecord(patch)) {
    const next: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(patch)) {
      next[key] = key in next ? deepMerge(next[key], value) : value;
    }

    return next;
  }

  return patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stripEtaExtension(fileName: string): string {
  return fileName.endsWith(".eta") ? fileName.slice(0, -4) : fileName;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT",
  );
}

function buildNextSteps({
  installRan,
  projectName,
  templateId,
}: {
  installRan: boolean;
  projectName: string;
  templateId: string;
}): string[] {
  const lines = [`Next steps for ${projectName}:`, `cd ${projectName}`];

  if (!installRan) {
    lines.push("bun install");
  }

  lines.push(
    templateId === "tauri-react" ? "bun run tauri dev" : "bun run dev",
  );
  return lines;
}
