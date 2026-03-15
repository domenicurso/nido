export type PromptKind = "text" | "confirm" | "select" | "multiselect";

export type PromptValue = boolean | string | string[];

export interface PromptOption {
  value: string;
  label: string;
  hint?: string;
}

export interface PromptDefinition {
  id: string;
  kind: PromptKind;
  label: string;
  description?: string;
  placeholder?: string;
  initialValue?: PromptValue;
  options?: PromptOption[];
  required?: boolean;
}

export interface CommandDefinition {
  command: string;
  args: string[];
}

export interface BaseApplyOperation {
  when?: string;
}

export interface MergeDirOperation extends BaseApplyOperation {
  type: "mergeDir";
  from?: string;
  to?: string;
}

export interface WriteOperation extends BaseApplyOperation {
  type: "write";
  path: string;
  template?: string;
  contents?: string;
}

export interface PatchJsonOperation extends BaseApplyOperation {
  type: "patchJson";
  path: string;
  merge: unknown;
}

export interface PatchTextOperation extends BaseApplyOperation {
  type: "patchText";
  path: string;
  find?: string;
  replace?: string;
  prepend?: string;
  append?: string;
  skipIfContains?: string;
}

export type ApplyOperation =
  | MergeDirOperation
  | PatchJsonOperation
  | PatchTextOperation
  | WriteOperation;

export interface TemplateDefinition {
  id: string;
  label: string;
  description?: string;
  directory: string;
  generator: CommandDefinition;
  prompts: PromptDefinition[];
  apply: ApplyOperation[];
}

export interface ModuleDefinition {
  id: string;
  label: string;
  description?: string;
  directory: string;
  dependencies: string[];
  incompatibilities: string[];
  supportedTemplates: string[];
  prompts: PromptDefinition[];
  apply: ApplyOperation[];
}

export interface Registry<T extends { id: string }> {
  all: T[];
  byId: Map<string, T>;
}

export interface PromptAnswers {
  projectName: string;
  templateId: string;
  moduleIds: string[];
  values: Record<string, PromptValue>;
}

export interface ResolvedSelection {
  template: TemplateDefinition;
  modules: ModuleDefinition[];
  autoAddedModuleIds: string[];
}

export interface GenerationContext extends ResolvedSelection {
  projectName: string;
  targetDir: string;
  answers: Record<string, PromptValue>;
}

export interface FileEditor {
  copyDir(from: string, to: string): Promise<void>;
  mergeDir(from: string, to: string): Promise<void>;
  patchJson<T>(path: string, patcher: (json: T) => T): Promise<void>;
  patchText(path: string, patcher: (text: string) => string): Promise<void>;
  write(path: string, contents: string): Promise<void>;
}

export interface CommandRunOptions {
  cwd: string;
  projectName: string;
  targetDir: string;
}

export interface GenerationResult {
  installRan: boolean;
  nextSteps: string[];
  targetDir: string;
}
