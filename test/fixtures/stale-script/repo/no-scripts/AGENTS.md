# Commands that are not package scripts

Cline placeholders: `bun run <script>` and `bun <file>.ts`

Other placeholders:

- `npm run <name>`
- `pnpm <file>.ts`
- `make <target>`
- `just {recipe}`
- `turbo run $TASK`
- `yarn run unfinished...`
- `pnpm run unfinished…`
- `yarn workspace fixture-app <script>`

Direct file runners:

- `bun scripts/build`
- `bun run scripts/build`
- `bun esbuild.mjs`
- `bun run esbuild.mjs`
- `node scripts/build.ts`
- `npx tsx scripts/build.ts`
- `deno run scripts/build.ts`

Bun commands: `bun x && bunx fixture-tool && bun install && bun add && bun remove && bun update && bun test && bun build && bun create && bun init && bun pm && bun --watch`
