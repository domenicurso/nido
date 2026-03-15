import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import type {
  ApplyOperation,
  PromptDefinition,
  Registry,
  TemplateDefinition,
} from "./types.ts";

const TEMPLATES_DIR = fileURLToPath(new URL("./templates", import.meta.url));

export async function loadTemplates(): Promise<Registry<TemplateDefinition>> {
  const directories = await readdir(TEMPLATES_DIR, { withFileTypes: true });
  const all = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = path.join(TEMPLATES_DIR, entry.name);
        const configPath = path.join(directory, "config.yaml");
        const source = await readFile(configPath, "utf8");
        const document = parse(source);
        return parseTemplate(document, configPath, directory);
      }),
  );

  all.sort((left, right) => left.label.localeCompare(right.label));

  return {
    all,
    byId: new Map(all.map((template) => [template.id, template])),
  };
}

function parseTemplate(
  value: unknown,
  configPath: string,
  directory: string,
): TemplateDefinition {
  const record = asRecord(value, configPath);
  const generator = asRecord(record.generator, `${configPath} generator`);

  return {
    apply: readApply(record.apply, configPath),
    description: readOptionalString(record.description),
    directory,
    generator: {
      args: readStringArray(generator.args, `${configPath} generator.args`),
      command: readString(generator.command, `${configPath} generator.command`),
    },
    id: readString(record.id, `${configPath} id`),
    label: readString(record.label, `${configPath} label`),
    prompts: readPrompts(record.prompts, configPath),
  };
}

function readApply(value: unknown, configPath: string): ApplyOperation[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${configPath} apply must be an array.`);
  }

  return value.map((item, index) =>
    parseApplyOperation(item, `${configPath} apply ${index}`),
  );
}

function parseApplyOperation(value: unknown, label: string): ApplyOperation {
  const record = asRecord(value, label);
  const type = readString(record.type, `${label} type`);
  const when = readOptionalString(record.when);

  switch (type) {
    case "mergeDir":
      return {
        from: readOptionalString(record.from),
        to: readOptionalString(record.to),
        type,
        when,
      };
    case "write":
      return {
        contents: readOptionalString(record.contents),
        path: readString(record.path, `${label} path`),
        template: readOptionalString(record.template),
        type,
        when,
      };
    case "patchJson":
      return {
        merge: record.merge ?? {},
        path: readString(record.path, `${label} path`),
        type,
        when,
      };
    case "patchText":
      return {
        append: readOptionalString(record.append),
        find: readOptionalString(record.find),
        path: readString(record.path, `${label} path`),
        prepend: readOptionalString(record.prepend),
        replace: readOptionalString(record.replace),
        skipIfContains: readOptionalString(record.skipIfContains),
        type,
        when,
      };
    default:
      throw new Error(`${label} type "${type}" is not supported.`);
  }
}

function readPrompts(value: unknown, configPath: string): PromptDefinition[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${configPath} prompts must be an array.`);
  }

  return value.map((prompt, index) => {
    const record = asRecord(prompt, `${configPath} prompt ${index}`);

    return {
      description: readOptionalString(record.description),
      id: readString(record.id, `${configPath} prompt ${index} id`),
      initialValue: readInitialValue(record.initialValue),
      kind: readString(
        record.kind,
        `${configPath} prompt ${index} kind`,
      ) as PromptDefinition["kind"],
      label: readString(record.label, `${configPath} prompt ${index} label`),
      options: readOptions(record.options, `${configPath} prompt ${index}`),
      placeholder: readOptionalString(record.placeholder),
      required: readOptionalBoolean(record.required),
    };
  });
}

function readOptions(
  value: unknown,
  configPath: string,
): PromptDefinition["options"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${configPath} options must be an array.`);
  }

  return value.map((option, index) => {
    const record = asRecord(option, `${configPath} option ${index}`);
    return {
      hint: readOptionalString(record.hint),
      label: readString(record.label, `${configPath} option ${index} label`),
      value: readString(record.value, `${configPath} option ${index} value`),
    };
  });
}

function readInitialValue(value: unknown): PromptDefinition["initialValue"] {
  if (
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  ) {
    return value;
  }

  throw new Error(
    "Prompt initialValue must be a boolean, string, or string array.",
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error("Expected a boolean value.");
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readString(value, "string");
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${label} must be a string array.`);
  }

  return value;
}
