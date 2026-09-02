import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const exampleRoot = path.join(repositoryRoot, 'examples', 'broken-repo');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.mjs');

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'amigolint-demo-'));

try {
  await cp(exampleRoot, temporaryRoot, { recursive: true });
  const status = await run(process.execPath, [cliPath], temporaryRoot);
  if (status !== 1) {
    throw new Error(
      `Expected the deliberately broken example to exit 1, received ${status}`,
    );
  }
  process.stdout.write(
    '\nDemo complete: exit code 1 is expected because the example contains errors.\n',
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Demo process ended from signal ${signal}`));
        return;
      }
      resolve(code ?? 2);
    });
  });
}
