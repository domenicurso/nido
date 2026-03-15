import type {
  ModuleDefinition,
  Registry,
  ResolvedSelection,
  TemplateDefinition,
} from "../types.ts";

interface ResolveInput {
  moduleIds: string[];
  templateId: string;
}

interface ResolveRegistries {
  modules: Registry<ModuleDefinition>;
  templates: Registry<TemplateDefinition>;
}

export function resolveSelection(
  input: ResolveInput,
  registries: ResolveRegistries,
): ResolvedSelection {
  const template = registries.templates.byId.get(input.templateId);

  if (!template) {
    throw new Error(`Unknown template "${input.templateId}".`);
  }

  const orderedModules: ModuleDefinition[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  for (const moduleId of input.moduleIds) {
    visitModule(
      moduleId,
      template.id,
      registries.modules,
      visited,
      visiting,
      orderedModules,
    );
  }

  for (const module of orderedModules) {
    for (const incompatibleId of module.incompatibilities) {
      if (visited.has(incompatibleId)) {
        throw new Error(
          `Module "${module.id}" cannot be used with "${incompatibleId}".`,
        );
      }
    }
  }

  return {
    autoAddedModuleIds: orderedModules
      .map((module) => module.id)
      .filter((moduleId) => !input.moduleIds.includes(moduleId)),
    modules: orderedModules,
    template,
  };
}

export function isModuleCompatible(
  module: ModuleDefinition,
  templateId: string,
): boolean {
  return (
    module.supportedTemplates.length === 0 ||
    module.supportedTemplates.includes(templateId)
  );
}

function visitModule(
  moduleId: string,
  templateId: string,
  registry: Registry<ModuleDefinition>,
  visited: Set<string>,
  visiting: Set<string>,
  orderedModules: ModuleDefinition[],
): void {
  if (visited.has(moduleId)) {
    return;
  }

  if (visiting.has(moduleId)) {
    throw new Error(`Circular module dependency detected at "${moduleId}".`);
  }

  const module = registry.byId.get(moduleId);

  if (!module) {
    throw new Error(`Unknown module "${moduleId}".`);
  }

  if (!isModuleCompatible(module, templateId)) {
    throw new Error(
      `Module "${moduleId}" is not compatible with template "${templateId}".`,
    );
  }

  visiting.add(moduleId);

  for (const dependencyId of module.dependencies) {
    visitModule(
      dependencyId,
      templateId,
      registry,
      visited,
      visiting,
      orderedModules,
    );
  }

  visiting.delete(moduleId);
  visited.add(moduleId);
  orderedModules.push(module);
}
