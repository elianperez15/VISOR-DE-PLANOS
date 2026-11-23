// third-party-licenses.mjs — Genera public/THIRD_PARTY_LICENSES.txt
//
// Las licencias de las librerías que usa el visor (MIT, ISC, Apache-2.0,
// MPL-2.0…) piden incluir su aviso de copyright y su texto en las copias del
// software. Este archivo los reúne; el enlace "Licencias" de los dos visores
// lo muestra. Se regenera solo antes de `npm run dev` y `npm run build`, así
// nunca queda desactualizado al cambiar dependencias.
//
// Recorre las dependencias de producción (y las "peer" instaladas, que también
// se empaquetan) desde package.json. Si un paquete no trae archivo de licencia
// pero declara MIT, se usa el texto MIT con su autor.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'public', 'THIRD_PARTY_LICENSES.txt');

const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/** Carpeta de un paquete, buscándolo como lo haría Node desde `fromDir`. */
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === dirname(dir)) return null;
  }
}

const packages = new Map();   // carpeta → datos (evita repetir y los ciclos)

function visit(name, fromDir, optional) {
  const dir = findPackage(name, fromDir);
  if (!dir) {
    if (!optional) console.warn(`  (no instalado: ${name})`);
    return;
  }
  if (packages.has(dir)) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i.test(f));
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  packages.set(dir, {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type || 'desconocida'),
    repository: (repository || pkg.homepage || '').replace(/^git\+/, '').replace(/\.git$/, ''),
    text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : null,
    author,
  });
  for (const dep of Object.keys(pkg.dependencies || {})) visit(dep, dir, false);
  for (const dep of Object.keys(pkg.peerDependencies || {})) visit(dep, dir, true);   // si está instalada, se empaqueta
}

const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const dep of Object.keys(app.dependencies || {})) visit(dep, root, false);

const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const missing = [];
const sections = list.map(p => {
  let text = p.text;
  if (!text && /^MIT$/i.test(p.license)) text = MIT(p.author || `los autores de ${p.name}`);
  if (!text) { missing.push(`${p.name} (${p.license})`); text = `Licencia ${p.license}. Texto completo: ${p.repository || 'ver el paquete en npm'}`; }
  return [
    '='.repeat(78),
    `${p.name} ${p.version} — ${p.license}`,
    p.repository ? `Código fuente: ${p.repository}` : '',
    '-'.repeat(78),
    text,
    '',
  ].filter(line => line !== '').join('\n');
});

const header = `Visor de Planos SAF — Licencias de software de terceros
${'='.repeat(78)}

Este visor usa las siguientes librerías de código abierto. Sus licencias
permiten usarlas y distribuirlas siempre que se incluyan estos avisos.

web-ifc se distribuye bajo MPL-2.0 sin modificaciones; su código fuente está
en https://github.com/ThatOpen/engine_web-ifc

${list.map(p => `  ${p.name.padEnd(30)} ${p.version.padEnd(10)} ${p.license}`).join('\n')}
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, header + '\n' + sections.join('\n') + '\n');
console.log(`Licencias de terceros: ${list.length} paquetes → public/THIRD_PARTY_LICENSES.txt`);
if (missing.length) console.warn(`  Sin texto de licencia (revisar): ${missing.join(', ')}`);
