# Third precision round

Generated directories without slash: `dist` `build` `out` `target` `coverage` `node_modules` `.next` `.turbo` `.cache` `__pycache__` `.venv` `venv`
Generated directories with slash: `dist/` `build/` `out/` `target/` `coverage/` `node_modules/` `.next/` `.turbo/` `.cache/` `__pycache__/` `.venv/` `venv/`
Generated directory children: `dist/index.js` `build/index.js` `out/index.js` `target/index.js` `coverage/index.js` `node_modules/pkg/index.js` `.next/index.js` `.turbo/index.js` `.cache/index.js` `__pycache__/module.py` `.venv/bin/python.py` `venv/bin/python.py`
Placeholders: `skills/{skill-name}/SKILL.md` `config/{...}/value.ts` `{...}` `~/.claude/projects/.../memory/`
Brace glob stays active: `skills/{alpha,beta}/SKILL.md`
Slashless globs: `*-meta.ts` `*.test.*` `*.spec.*` `*.showcase.js`
Repository-root slash globs: `packages/**/*.test.*` `packages/*/`
Document-relative slash globs: `fixtures/**/*.spec.*` `fixtures/**/`
Plain word slash tokens: `Bash/Shell` `N/A` `Yes/No`
Direct extension probes: `./modules/direct-ts` `./modules/direct-tsx` `./modules/direct-js` `./modules/direct-jsx` `./modules/direct-mjs` `./modules/direct-cjs` `./modules/direct-mts` `./modules/direct-cts` `./modules/direct-py` `./modules/direct-md`
Index extension probes: `./modules/index-ts` `./modules/index-tsx` `./modules/index-js` `./modules/index-jsx` `./modules/index-mjs` `./modules/index-cjs` `./modules/index-mts` `./modules/index-cts` `./modules/index-py` `./modules/index-md`
Exact parent extension probe: `../ThemedDataTable`
Missing relative extensionless: `../MissingComponent` `./MissingLocalComponent`
Directory basenames elsewhere: `core/` `models/` `src/` `__tests__/`
Missing directory basename: `docs/`
Short fuzzy distance two: `code/abcd`
Short fuzzy distance one: `code/abxz`
Long fuzzy distance two: `code/compnentx`
