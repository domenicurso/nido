#!/usr/bin/env bun

import { cancel, intro, outro, spinner } from "@clack/prompts";
import color from "picocolors";

import { applyProject } from "./engine/apply.ts";
import { resolveSelection } from "./engine/resolve.ts";
import { loadModules } from "./modules.ts";
import { runPromptFlow } from "./prompts.ts";
import { loadTemplates } from "./templates.ts";

async function main() {
  console.log();
  intro(color.inverse(color.yellow(" Nido ")));

  const [templates, modules] = await Promise.all([
    loadTemplates(),
    loadModules(),
  ]);
  const answers = await runPromptFlow({ templates, modules });

  if (!answers) {
    cancel("Cancelled.");
    return;
  }

  const selection = resolveSelection(
    {
      moduleIds: answers.moduleIds,
      templateId: answers.templateId,
    },
    { modules, templates },
  );

  const progress = spinner();
  progress.start("Generating project");

  try {
    const result = await applyProject({
      answers,
      cwd: process.cwd(),
      onStep(message) {
        progress.message(message);
      },
      selection,
    });

    progress.stop(`Created ${answers.projectName}`);
    outro(result.nextSteps.join("\n"));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Generation failed with an unknown error.";
    progress.error(message);
    process.exitCode = 1;
  }
}

void main();
