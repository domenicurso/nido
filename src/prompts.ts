import {
  confirm,
  isCancel,
  log,
  multiselect,
  note,
  select,
  text,
} from "@clack/prompts";

import type {
  ModuleDefinition,
  PromptAnswers,
  PromptDefinition,
  PromptValue,
  Registry,
  TemplateDefinition,
} from "./types.ts";

import { isModuleCompatible, resolveSelection } from "./engine/resolve.ts";

const GLOBAL_PROMPTS: PromptDefinition[] = [
  {
    id: "global.installDeps",
    initialValue: false,
    kind: "confirm",
    label: "Run bun install after generation?",
  },
];

interface PromptFlowInput {
  templates: Registry<TemplateDefinition>;
  modules: Registry<ModuleDefinition>;
}

export async function runPromptFlow({
  templates,
  modules,
}: PromptFlowInput): Promise<PromptAnswers | null> {
  const projectName = await promptProjectName();

  if (!projectName) {
    return null;
  }

  const templateId = await promptTemplate(templates);

  if (!templateId) {
    return null;
  }

  const compatibleModules = modules.all.filter((module) =>
    isModuleCompatible(module, templateId),
  );

  const moduleIds = await promptModules(compatibleModules);

  if (!moduleIds) {
    return null;
  }

  let selection;

  try {
    selection = resolveSelection(
      { moduleIds, templateId },
      { modules, templates },
    );
  } catch (error) {
    log.error(
      error instanceof Error ? error.message : "Unable to resolve modules.",
    );
    return null;
  }

  const values: Record<string, PromptValue> = {
    "global.packageManager": "bun",
  };

  const prompts = [
    ...GLOBAL_PROMPTS,
    ...selection.template.prompts,
    ...selection.modules.flatMap((module) => module.prompts),
  ];

  for (const prompt of prompts) {
    const value = await renderPrompt(prompt);

    if (value === null) {
      return null;
    }

    values[prompt.id] = value;
  }

  note(
    buildReviewSummary({
      autoAddedModuleIds: selection.autoAddedModuleIds,
      modules: selection.modules,
      projectName,
      template: selection.template,
      values,
    }),
    "Review",
  );

  const shouldGenerate = await confirm({
    initialValue: true,
    message: "Generate project?",
  });

  if (isCancel(shouldGenerate) || !shouldGenerate) {
    return null;
  }

  return {
    moduleIds,
    projectName,
    templateId,
    values,
  };
}

async function promptProjectName(): Promise<string | null> {
  const value = await text({
    message: "Project name",
    placeholder: "my-app",
    validate(input) {
      if (!input) {
        return "Please enter a project name.";
      }

      if (!/^[a-z0-9._-]+$/i.test(input)) {
        return "Use letters, numbers, dots, dashes, or underscores.";
      }
    },
  });

  return isCancel(value) ? null : value.trim();
}

async function promptTemplate(
  templates: Registry<TemplateDefinition>,
): Promise<string | null> {
  const value = await select({
    message: "Choose a base template",
    options: templates.all.map((template) => ({
      hint: template.description,
      label: template.label,
      value: template.id,
    })),
  });

  return isCancel(value) ? null : value;
}

async function promptModules(
  modules: ModuleDefinition[],
): Promise<string[] | null> {
  const value = await multiselect({
    initialValues: [],
    message: "Choose optional modules",
    options: modules.map((module) => ({
      hint: module.description,
      label: module.label,
      value: module.id,
    })),
    required: false,
  });

  return isCancel(value) ? null : value;
}

async function renderPrompt(
  prompt: PromptDefinition,
): Promise<PromptValue | null> {
  switch (prompt.kind) {
    case "confirm": {
      const value = await confirm({
        initialValue: Boolean(prompt.initialValue),
        message: prompt.label,
      });
      return isCancel(value) ? null : value;
    }

    case "multiselect": {
      const value = await multiselect({
        initialValues: Array.isArray(prompt.initialValue)
          ? prompt.initialValue
          : [],
        message: prompt.label,
        options: (prompt.options ?? []).map((option) => ({
          hint: option.hint,
          label: option.label,
          value: option.value,
        })),
        required: prompt.required,
      });
      return isCancel(value) ? null : value;
    }

    case "select": {
      const value = await select({
        initialValue:
          typeof prompt.initialValue === "string"
            ? prompt.initialValue
            : undefined,
        message: prompt.label,
        options: (prompt.options ?? []).map((option) => ({
          hint: option.hint,
          label: option.label,
          value: option.value,
        })),
      });
      return isCancel(value) ? null : value;
    }

    case "text": {
      const value = await text({
        initialValue:
          typeof prompt.initialValue === "string"
            ? prompt.initialValue
            : undefined,
        message: prompt.label,
        placeholder: prompt.placeholder,
        validate(input) {
          if (!prompt.required) {
            return;
          }

          if (!input?.trim()) {
            return "This value is required.";
          }
        },
      });
      return isCancel(value) ? null : value.trim();
    }
  }
}

function buildReviewSummary({
  autoAddedModuleIds,
  modules,
  projectName,
  template,
  values,
}: {
  autoAddedModuleIds: string[];
  modules: ModuleDefinition[];
  projectName: string;
  template: TemplateDefinition;
  values: Record<string, PromptValue>;
}): string {
  const lines = [
    `Project: ${projectName}`,
    `Template: ${template.label}`,
    `Modules: ${modules.length > 0 ? modules.map((module) => module.label).join(", ") : "None"}`,
  ];

  if (autoAddedModuleIds.length > 0) {
    const autoAddedLabels = modules
      .filter((module) => autoAddedModuleIds.includes(module.id))
      .map((module) => module.label);
    lines.push(`Auto-added: ${autoAddedLabels.join(", ")}`);
  }

  const visibleValues = Object.entries(values).filter(
    ([key]) => key !== "global.packageManager",
  );

  if (visibleValues.length > 0) {
    lines.push("");
    lines.push("Preferences:");

    for (const [key, value] of visibleValues) {
      lines.push(`- ${key}: ${formatValue(value)}`);
    }
  }

  return lines.join("\n");
}

function formatValue(value: PromptValue): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value;
}
