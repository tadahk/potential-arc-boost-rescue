// Run: node tests/test.js <folder-containing-boost-folders>
// Checks the converter against real Arc Boost folders.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('../converter.js');

let failures = 0;
function check(cond, msg) {
  if (cond) return;
  failures++;
  console.error('FAIL: ' + msg);
}

// Same rule Stylus uses to accept an imported style (src/js/style-util.js)
function styleJSONseemsValid(json) {
  return json && typeof json.name == 'string' && json.name.trim() &&
    Array.isArray(json.sections) && typeof json.sections[0]?.code === 'string';
}

function readTree(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...readTree(full, base));
    else out.push({ path: 'boosts/' + path.relative(base, full).split(path.sep).join('/'), data: new Uint8Array(fs.readFileSync(full)) });
  }
  return out;
}

// --- unit checks ---
check(R.matchToRegex('*://*.facebook.com/*') === 'https?:\\/\\/([^/]*\\.)?facebook\\.com/.*', 'matchToRegex basic');
check(JSON.stringify(R.appliesTo(['*://*.www.youtube.com/*'])) === '{"domains":["www.youtube.com"]}', 'appliesTo domain');
check(JSON.stringify(R.appliesTo(['https://github.com/notifications*'])).includes('regexps'), 'appliesTo path -> regexp');
check(JSON.stringify(R.appliesTo(['<all_urls>'])) === '{}', 'appliesTo all urls');
check(new RegExp('^' + R.matchToRegex('*://*.facebook.com/*') + '$').test('https://www.facebook.com/home'), 'regex matches subdomain');
check(new RegExp('^' + R.matchToRegex('*://*.facebook.com/*') + '$').test('https://facebook.com/'), 'regex matches bare domain');
check(!new RegExp('^' + R.matchToRegex('*://*.facebook.com/*') + '$').test('https://notfacebook.com/'), 'regex rejects lookalike');

// synthetic: disabled boost, scope only, extra files, no code
const synthetic = [
  { path: 'b/aaa/boost.config.json', data: JSON.stringify({ id: 'aaa', name: 'Quiet GitHub', scope: 'github.com', extensionEnabled: false, components: { contentStylesheet: { path: 'styles.css', enabled: true } } }) },
  { path: 'b/aaa/styles.css', data: '.Header{display:none}' },
  { path: 'b/bbb/boost.config.json', data: JSON.stringify({ id: 'bbb', name: 'Empty one', scope: 'x.com' }) },
  { path: 'b/bbb/styles.css', data: '/* nothing */' },
  { path: 'b/ccc/manifest.json', data: JSON.stringify({ name: 'Popup thing', manifest_version: 3, version: '0.0.1', content_scripts: [{ matches: ['https://news.ycombinator.com/*'], js: ['content.js'], run_at: 'document_end' }] }) },
  { path: 'b/ccc/content.js', data: 'console.log("hi")' },
  { path: 'b/ccc/popup.html', data: '<p>x</p>' },
  { path: 'b/.DS_Store', data: 'junk' }
];
const s = R.convert(synthetic);
check(s.boosts.length === 3, 'synthetic: finds 3 boosts, got ' + s.boosts.length);
const quiet = s.boosts.find(b => b.name === 'Quiet GitHub');
check(quiet && !quiet.enabled, 'synthetic: disabled flag read');
check(quiet && quiet.matches[0] === '*://*.github.com/*', 'synthetic: scope -> match');
check(s.stylus.find(x => x.name.startsWith('Quiet GitHub')).enabled === false, 'synthetic: stylus keeps disabled');
check(s.extension.count === 1, 'synthetic: extension skips disabled + empty, got ' + s.extension.count);
check(s.boosts.find(b => b.name === 'Empty one').warnings.some(w => /No CSS or script/.test(w)), 'synthetic: empty warned');
check(s.boosts.find(b => b.name === 'Popup thing').warnings.some(w => /popup\.html/.test(w)), 'synthetic: extras warned');

// --- real samples ---
const dir = process.argv[2];
if (dir) {
  const files = readTree(dir);
  const out = R.convert(files);
  console.log('Real samples: ' + out.boosts.length + ' boosts, ' + out.counts.stylus + ' styles, ' +
    out.counts.userscripts + ' userscripts, ' + out.counts.extension + ' in extension');
  check(out.boosts.length === 11, 'expected 11 real boosts, got ' + out.boosts.length);

  for (const st of out.stylus) check(styleJSONseemsValid(st), 'stylus style invalid: ' + st.name);
  JSON.parse(out.stylusJson);

  for (const u of out.userscripts) {
    check(/\/\/ ==UserScript==[\s\S]*@match[\s\S]*\/\/ ==\/UserScript==/.test(u.data), 'userscript header: ' + u.path);
    try { new vm.Script(u.data, { filename: u.path }); } catch (e) { check(false, 'userscript syntax ' + u.path + ': ' + e.message); }
  }

  const man = JSON.parse(out.extension.files[0].data);
  check(man.manifest_version === 3 && man.content_scripts.length === out.extension.count, 'extension manifest');
  for (const cs of man.content_scripts) {
    for (const m of cs.matches) check(R.isValidMatch(m), 'extension bad match ' + m);
    for (const p of [...(cs.css || []), ...(cs.js || [])]) check(out.extension.files.some(f => f.path === p), 'extension missing ' + p);
  }

  const zip = R.makeZip(out.zipEntries);
  const zipPath = path.join(process.argv[3] || '.', 'arc-boosts-rescued.zip');
  fs.writeFileSync(zipPath, zip);
  console.log('Wrote ' + zipPath + ' (' + zip.length + ' bytes)');
  for (const b of out.boosts) {
    console.log(' - ' + b.name + ' | ' + R.sitesLabel(b.matches) + ' | css:' + !!b.css + ' js:' + !!b.js +
      (b.warnings.length ? ' | ' + b.warnings.join('; ') : ''));
  }
}

console.log(failures ? failures + ' check(s) failed' : 'All checks passed');
process.exit(failures ? 1 : 0);
