# Nido

Nido is a modular scaffolding CLI for bootstrapping projects from a base template and layering optional modules on top.

It is built with:

- Bun
- TypeScript
- [`@clack/prompts`](https://github.com/bombshell-dev/clack)
- [`picocolors`](https://github.com/alexeyraspopov/picocolors)
- [`yaml`](https://eemeli.org/yaml/)
- [`eta`](https://eta.js.org/)

## What It Does

Nido guides the user through a compact prompt flow:

1. enter a project name
2. choose a base template
3. choose compatible optional modules
4. answer template and module specific questions
5. review the final setup
6. generate the project
7. see next steps

The intended mental model is:

- templates create the world
- modules modify the world
- prompts only describe the world

## Current Templates

- `next`
- `tauri-react`
- `vite-react`

## Current Modules

- `tailwindcss`
- `motion`
- `oxfmt`
- `oxlint`

## Project Structure

```text
src/
├── engine/
│   ├── apply.ts
│   ├── file-editor.ts
│   └── resolve.ts
├── modules/
│   └── ...
├── templates/
│   └── ...
├── index.ts
├── modules.ts
├── prompts.ts
├── templates.ts
└── types.ts
```

Each template or module directory contains:

- a `config.yaml` file for metadata, prompts, compatibility, and apply operations
- an optional `files/` directory for assets rendered with Eta

Example:

```text
src/modules/tailwindcss/
├── config.yaml
└── files/
    ├── lib/
    │   └── cn.ts.eta
    └── postcss.config.mjs.eta
```

## How Generation Works

At a high level:

1. [`src/prompts.ts`](src/prompts.ts) collects answers
2. [`src/engine/resolve.ts`](src/engine/resolve.ts) resolves module compatibility and dependencies
3. [`src/engine/apply.ts`](src/engine/apply.ts) runs the selected template generator CLI
4. the apply engine processes declarative operations from template and module configs

Supported apply operations:

- `mergeDir`
- `write`
- `patchJson`
- `patchText`

Template and module assets can use Eta expressions such as:

```eta
<%= it.projectName %>
<%= it.template.id === 'next' ? 'lib/cn.ts' : 'src/lib/cn.ts' %>
```

## Getting Started

Install dependencies:

```bash
bun install
```

Run the CLI:

```bash
bun src/index.ts
```

Use it as a global `nido` command during local development:

```bash
# from this repository
bun link

# from any other directory
bun link nido
nido
```

Install it as a global `nido` command after publishing:

```bash
bun add -g nido
nido
```

`nido` uses a Bun shebang, so Bun must be installed on the machine that runs it.

Validate the codebase:

```bash
bun run typecheck
bun run format:check
```

## Example

A typical flow might be:

1. run `bun src/index.ts`
2. choose `Next.js`
3. add `Tailwind CSS` and `Motion`
4. confirm generation

That setup currently generates:

- Tailwind v4 PostCSS configuration
- a `cn()` helper
- Motion easing helpers
- a starter animated view

## Adding a Template

1. Create a new directory under [`src/templates`](src/templates).
2. Add a `config.yaml`.
3. Add any renderable assets under `files/`.
4. Register prompts and declarative apply operations in YAML.

## Adding a Module

1. Create a new directory under [`src/modules`](src/modules).
2. Add a `config.yaml`.
3. Add any renderable assets under `files/`.
4. Declare dependencies, incompatibilities, supported templates, and apply operations.
