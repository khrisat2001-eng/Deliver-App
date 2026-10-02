// Verifies that every locale has exactly the keys of en.json and the same {placeholders}.
import { readFileSync } from 'node:fs';

const load = (l) => JSON.parse(readFileSync(new URL(`./locales/${l}.json`, import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('./locales/meta.json', import.meta.url), 'utf8'));
const ref = load('en');
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

let errors = 0;
for (const locale of Object.keys(meta)) {
  const t = load(locale);
  for (const k of Object.keys(ref)) {
    if (!(k in t)) { console.error(`${locale}: missing ${k}`); errors++; }
    else if (vars(t[k]) !== vars(ref[k])) { console.error(`${locale}: placeholder mismatch in ${k}`); errors++; }
  }
  for (const k of Object.keys(t)) if (!(k in ref)) { console.error(`${locale}: unknown key ${k}`); errors++; }
}
if (errors) process.exit(1);
console.log(`i18n OK: ${Object.keys(meta).join(', ')} × ${Object.keys(ref).length} keys`);
