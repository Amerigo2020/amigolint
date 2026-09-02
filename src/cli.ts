#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';

const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

new Command()
  .name('amigolint')
  .description(
    'Lint your CLAUDE.md, AGENTS.md, Cursor rules and Copilot instructions.',
  )
  .version(version)
  .argument('[paths...]', 'instruction files to lint')
  .action(() => {
    console.log('no files linted yet');
  })
  .parse();
