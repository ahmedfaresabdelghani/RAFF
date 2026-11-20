// Static security checks over first-party code. Run: npm run lint:security
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const banned = [
  [/\binnerHTML\b/, 'innerHTML'], [/\bouterHTML\b/, 'outerHTML'], [/insertAdjacentHTML/, 'insertAdjacentHTML'],
  [/document\.write/, 'document.write'], [/\beval\s*\(/, 'eval()'], [/new\s+Function\s*\(/, 'new Function()'],
  [/\bsetTimeout\s*\(\s*['"`]/, 'setTimeout(string)'], [/\bsetInterval\s*\(\s*['"`]/, 'setInterval(string)'],
  [/\bfetch\s*\(/, 'fetch() outside service worker'], [/XMLHttpRequest/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'],
  [/sendBeacon/, 'sendBeacon'], [/localStorage\.setItem\([^)]*(password|token|secret)/i, 'secret in localStorage'],
  [/\bimportScripts\b/, 'importScripts'], [/https?:\/\/(?!wa\.me|www\.w3\.org\/2000\/svg)/, 'hard-coded external URL'],
];
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});
let bad = 0;
for (const file of ['js', 'sw.js'].flatMap((x) => (statSync(x).isDirectory() ? walk(x) : [x]))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    for (const [re, name] of banned) {
      if (name.startsWith('fetch()') && file === 'sw.js') continue;
      if (re.test(line)) { bad++; console.log(`${file}:${i + 1}  ${name}\n    ${line.trim()}`); }
    }
  });
}
const html = readFileSync('index.html', 'utf8');
if (/\sstyle\s*=/.test(html.replace(/<noscript>[\s\S]*<\/noscript>/, ''))) { bad++; console.log('index.html: inline style attribute'); }
if (/<script(?![^>]*\bsrc=)/.test(html)) { bad++; console.log('index.html: inline <script>'); }
if (/\son\w+\s*=/.test(html)) { bad++; console.log('index.html: inline event handler'); }
console.log(bad ? `\n${bad} finding(s)` : 'security lint: clean');
process.exit(bad ? 1 : 0);
