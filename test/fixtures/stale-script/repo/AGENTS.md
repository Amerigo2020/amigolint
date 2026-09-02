# Commands

Missing npm script: `npm run missing-script`
Existing pnpm script: `pnpm build`
Package-manager operation: `pnpm install`
Existing npm shorthand: `npm test`
Missing Make target: `make missing-target`
Existing just recipe: `just release`
Missing turbo task: `turbo run missing-task`
Workspace-only script: `pnpm workspace-check`
Prose commands are not scanned: npm run prose-only

```bash
yarn run block-missing
pnpm build
```

```text
npm run ignored-language
```

```
bun run build
```

Prose stays ignored: Run just the CLI integration tests, then yarn run prose-missing.

```bash
# Run just the CLI integration tests
npm run build # yarn run comment-missing
npm run "hash#script" # pnpm comment-missing
```

Workspace commands:

- `yarn workspace fixture-app workspace-check`
- `yarn workspace fixture-app missing-yarn-workspace`
- `yarn workspace missing-package missing-unknown-workspace`
- `yarn workspaces foreach --all run missing-foreach`
- `pnpm --filter fixture-app workspace-check`
- `pnpm -F fixture-app missing-pnpm-workspace`
- `pnpm --filter missing-package missing-unknown-filter`
- `npm -w fixture-app run workspace-check`
- `npm --workspace fixture-app run missing-npm-workspace`
- `npm --workspace missing-package run missing-unknown-npm`
- `turbo run build --filter=fixture-app`
- `turbo run missing-filtered-task --filter=fixture-app`

Package-manager binaries:

- `yarn fixture-dependency`
- `pnpm fixture-dependency`
- `bun fixture-dependency`
- `pnpm fixture-bin`
- `bun bare-missing`

Natural-language make and just phrases:

`make the && just a && make an && just to && make and && just or && make it && just all && make run && just sure && make use && just do && make not`

```sh
# npm run comment-line-missing
```
