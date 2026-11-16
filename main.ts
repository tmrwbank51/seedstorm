// SEEDSTORM entry program: copies the game and its screenshots into the
// output directory and writes the dossier with the kit's library. Node 22
// standard library only; plain JavaScript syntax in this .ts file so it runs
// as-is under type stripping, with no build step and no network.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
// One summary line for the operator; it changes no output bytes.
console.log('seedstorm: wrote ' + outputDir + ' (dossier ' + dossier.byteLength + ' bytes)');
