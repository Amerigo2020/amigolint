# Stale path edge cases

Data shapes: `edges[]` and `crossings[]`
CSS selector: `[data-theme="dark"]`
Quoted glob: `"missing/*.ts"`
Equals glob: `theme=missing/*.css`
Scoped packages: `@atlaskit/*` and `@higgsfield/quanta/*`
Repository scope directory: `@workspace/missing/*`
Bare extensions: `.md`, `.env`, `.ts`
Ambiguous globs: `*-sketch` and `*_references`
Path aliases without tsconfig aliases: `@/path/to/file.json` and `~/path/to/file.json`
Prose syntax: selector=[data-theme="dark"] quoted="src/missing/*.ts" equal=src/missing/*.css
