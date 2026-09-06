import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const distRoot = join(projectRoot, '..', 'dist');
const compiledSourceRoot = join(distRoot, 'src');

if (existsSync(compiledSourceRoot)) {
  for (const entry of readdirSync(compiledSourceRoot)) {
    cpSync(join(compiledSourceRoot, entry), join(distRoot, entry), {
      recursive: true,
      force: true,
    });
  }
  rmSync(compiledSourceRoot, { recursive: true, force: true });
}
rmSync(join(distRoot, 'tests'), { recursive: true, force: true });
rmSync(join(distRoot, 'vitest.config.js'), { force: true });

const source = join(projectRoot, '..', 'src', 'desktop', 'index.html');
const destination = join(distRoot, 'desktop', 'index.html');
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

const cssSource = join(projectRoot, '..', 'src', 'desktop', 'styles.css');
const cssDestination = join(distRoot, 'desktop', 'styles.css');
if (existsSync(cssSource)) {
  copyFileSync(cssSource, cssDestination);
}

