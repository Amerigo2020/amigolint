import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const outputPath = path.join(repositoryRoot, 'demo', 'demo.gif');
const tapePath = path.join(repositoryRoot, 'demo', 'demo.tape');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.mjs');

if (!(await commandExists('vhs'))) {
  process.stdout.write(
    'Skipping demo GIF: install vhs (https://github.com/charmbracelet/vhs) and rerun `pnpm demo:gif`.\n',
  );
  process.exit(0);
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'amigolint-vhs-'));

try {
  await cp(
    path.join(repositoryRoot, 'examples', 'broken-repo'),
    temporaryRoot,
    { recursive: true },
  );
  const binDirectory = path.join(temporaryRoot, 'node_modules', '.bin');
  await mkdir(binDirectory, { recursive: true });
  const localCliPath = path.join(binDirectory, 'amigolint');
  await symlink(cliPath, localCliPath);
  await chmod(cliPath, 0o755);

  const sourceTape = await readFile(tapePath, 'utf8');
  const temporaryTape = path.join(temporaryRoot, 'demo.tape');
  await writeFile(
    temporaryTape,
    sourceTape.replace(
      /^Output\s+demo\/demo\.gif$/m,
      `Output ${JSON.stringify(outputPath)}`,
    ),
  );

  const status = await run('vhs', [temporaryTape], temporaryRoot);
  if (status !== 0) {
    throw new Error(`vhs exited with status ${status}`);
  }

  const size = (await lstat(outputPath)).size;
  if (size >= 3_000_000) {
    throw new Error(`demo/demo.gif is ${size} bytes; it must be under 3000000`);
  }
  process.stdout.write(`Created demo/demo.gif (${size} bytes).\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`vhs ended from signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
