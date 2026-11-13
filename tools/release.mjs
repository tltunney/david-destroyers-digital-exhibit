// Run before publishing a code change:   node tools/release.mjs
// Writes version.json with a new version number and the list of script files. index.html reads it
// fresh on every visit and loads each script with that number, so browsers never run old cached code.
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = readdirSync(resolve(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const version = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '.');
writeFileSync(resolve(root, 'version.json'), JSON.stringify({ version, modules }, null, 2) + '\n');
console.log(`version ${version}: ${modules.join(', ')}`);
