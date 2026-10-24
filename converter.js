/*
 * Arc Boost Rescue — converter
 * Turns the Boost folders Arc keeps on disk into files other browsers can import:
 *   - a Stylus import file (CSS)
 *   - userscripts for Violentmonkey / Tampermonkey (CSS + JavaScript)
 *   - one combined Chromium extension (Chrome, Brave, Edge, Dia, Vivaldi)
 *   - an untouched backup of the original folders
 * Pure functions, no network access. Runs in the browser and in Node (for tests).
 */
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const NAMESPACE = 'https://github.com/tadahk/potential-arc-boost-rescue';
  const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|\._[^/]*)(\/|$)/;

  /* ---------- helpers ---------- */

  function toText(bytes) {
    return typeof bytes === 'string' ? bytes : dec.decode(bytes);
  }

  function toBytes(data) {
    return typeof data === 'string' ? enc.encode(data) : data;
  }

  function parseJSON(text) {
    try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) { return null; }
  }

  function hasRealCode(code) {
    if (!code) return false;
    const stripped = code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .trim();
    return stripped.length > 0;
  }

  function slugify(name, used) {
    let base = String(name || 'boost')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'boost';
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = base + '-' + n++;
    used.add(slug);
    return slug;
  }

  function dirname(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }

  /* ---------- match patterns ---------- */

  const MATCH_RX = /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^/*]+|[^/*]+)?(\/.*)$/;

  function isValidMatch(p) {
    return p === '<all_urls>' || MATCH_RX.test(p);
  }

  function escapeRx(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Chrome match pattern -> full-URL regular expression (for Stylus "regexps"). */
  function matchToRegex(p) {
    if (p === '<all_urls>') return '.*';
    const m = MATCH_RX.exec(p);
    if (!m) return null;
    const [, scheme, host = '', path] = m;
    const sch = scheme === '*' ? 'https?' : escapeRx(scheme);
    let h;
    if (host === '*' || host === '') h = '[^/]*';
    else if (host.startsWith('*.')) h = '([^/]*\\.)?' + escapeRx(host.slice(2));
    else h = escapeRx(host);
    const pth = path.split('*').map(escapeRx).join('.*');
    return sch + ':\\/\\/' + h + pth;
  }

  /** Chrome match patterns -> one Stylus section's "applies to" fields. */
  function appliesTo(matches) {
    const domains = [];
    const regexps = [];
    let global = false;
    for (const p of matches) {
      if (p === '<all_urls>') { global = true; continue; }
      const m = MATCH_RX.exec(p);
      if (!m) continue;
      const [, scheme, host = '', path] = m;
      if ((host === '*' || host === '') && path === '/*' && (scheme === '*' || /^https?$/.test(scheme))) {
        global = true;
        continue;
      }
      if (path === '/*' && (scheme === '*' || /^https?$/.test(scheme)) && host && host !== '*') {
        const d = host.startsWith('*.') ? host.slice(2) : host;
        if (!domains.includes(d)) domains.push(d);
      } else {
        const rx = matchToRegex(p);
        if (rx && !regexps.includes(rx)) regexps.push(rx);
      }
    }
    if (global) return {};
    const out = {};
    if (domains.length) out.domains = domains;
    if (regexps.length) out.regexps = regexps;
    return out;
  }

  function scopeToMatch(scope) {
    if (!scope || typeof scope !== 'string') return null;
    const host = scope.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').replace(/^\*\./, '');
    if (!host) return null;
    return '*://*.' + host + '/*';
  }

  function sitesLabel(matches) {
    const a = appliesTo(matches);
    if (!a.domains && !a.regexps) return matches.length ? 'all sites' : 'unknown site';
    return [].concat(a.domains || [], (a.regexps || []).map(() => 'specific pages')).filter(
      (v, i, arr) => arr.indexOf(v) === i).join(', ');
  }

  /* ---------- reading Boost folders ---------- */

  /**
   * Group a flat list of {path, data} into Boost folders.
   * A Boost folder is any folder that holds boost.config.json, or a manifest.json
   * next to styles.css / content.js.
   */
  function groupBoosts(files) {
    const clean = files
      .map(f => ({ path: f.path.replace(/\\/g, '/').replace(/^\/+/, ''), data: f.data }))
      .filter(f => !IGNORED.test(f.path));
    const dirs = new Map();
    for (const f of clean) {
      const d = dirname(f.path);
      if (!dirs.has(d)) dirs.set(d, []);
      dirs.get(d).push(f);
    }
    const roots = [];
    for (const [d, list] of dirs) {
      const names = list.map(f => f.path.slice(d ? d.length + 1 : 0));
      const isBoost = names.includes('boost.config.json') ||
        (names.includes('manifest.json') && (names.includes('styles.css') || names.includes('content.js')));
      if (isBoost) roots.push(d);
    }
    // nested files (rare) belong to the closest Boost root above them
    roots.sort((a, b) => b.length - a.length);
    const groups = new Map(roots.map(r => [r, []]));
    for (const f of clean) {
      const r = roots.find(r => r === '' || f.path === r || f.path.startsWith(r + '/'));
      if (r !== undefined) groups.get(r).push({ rel: r ? f.path.slice(r.length + 1) : f.path, data: f.data, path: f.path });
    }
    return [...groups.entries()]
      .map(([dir, list]) => ({ dir, files: list }))
      .sort((a, b) => a.dir.localeCompare(b.dir));
  }

  function parseBoost(group) {
    const byRel = new Map(group.files.map(f => [f.rel, f]));
    const text = rel => (byRel.has(rel) ? toText(byRel.get(rel).data) : null);
    const warnings = [];
    const manifest = parseJSON(text('manifest.json') || '') || {};
    const config = parseJSON(text('boost.config.json') || '') || {};
    if (byRel.has('manifest.json') && !manifest.manifest_version) warnings.push('manifest.json could not be read');
    if (byRel.has('boost.config.json') && !config.id && !config.name && !config.scope) warnings.push('boost.config.json could not be read');

    const folderName = group.dir.split('/').pop() || 'boost';
    const defaultName = /^My .+ (Style |Custom |Inject )?Boost$/;
    let name = config.name || manifest.name || folderName;
    if (manifest.name && defaultName.test(config.name || '') && !defaultName.test(manifest.name)) name = manifest.name;

    const comps = config.components || {};
    const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];

    let matches = [];
    let runAt = 'document_idle';
    const cssPaths = [];
    const jsPaths = [];
    for (const cs of scripts) {
      for (const m of cs.matches || []) if (!matches.includes(m)) matches.push(m);
      for (const p of cs.css || []) if (!cssPaths.includes(p)) cssPaths.push(p);
      for (const p of cs.js || []) if (!jsPaths.includes(p)) jsPaths.push(p);
      if (cs.run_at) runAt = cs.run_at;
    }
    if (comps.contentStylesheet && comps.contentStylesheet.path && !cssPaths.includes(comps.contentStylesheet.path)) cssPaths.push(comps.contentStylesheet.path);
    if (comps.contentScript && comps.contentScript.path && !jsPaths.includes(comps.contentScript.path)) jsPaths.push(comps.contentScript.path);
    if (!cssPaths.length && byRel.has('styles.css')) cssPaths.push('styles.css');
    if (!jsPaths.length && byRel.has('content.js')) jsPaths.push('content.js');

    if (!matches.length) {
      const m = scopeToMatch(config.scope);
      if (m) matches.push(m);
    }
    const badMatches = matches.filter(m => !isValidMatch(m));
    if (badMatches.length) warnings.push('Skipped site pattern(s) it could not read: ' + badMatches.join(', '));
    matches = matches.filter(isValidMatch);
    const internal = matches.filter(m => {
      const h = (MATCH_RX.exec(m) || [])[2] || '';
      const host = h.replace(/^\*\./, '');
      return host && host !== '*' && !host.includes('.') && host !== 'localhost';
    });
    if (internal.length) warnings.push('Targets an Arc-only page (' + internal.join(', ') + '), so it won\'t apply in other browsers');
    if (!matches.length) warnings.push('No site found — it was converted to run on all sites; edit it after importing');

    const cssOn = !(comps.contentStylesheet && comps.contentStylesheet.enabled === false);
    const jsOn = !(comps.contentScript && comps.contentScript.enabled === false);
    const readAll = paths => paths.map(p => {
      const t = text(p.replace(/^\.?\//, ''));
      if (t === null) warnings.push('Missing file: ' + p);
      return t || '';
    }).join('\n\n');
    const css = cssOn ? readAll(cssPaths) : '';
    const js = jsOn ? readAll(jsPaths) : '';
    if (!cssOn && cssPaths.length) warnings.push('Its CSS was switched off in Arc, so it was left out (kept in the backup)');
    if (!jsOn && jsPaths.length) warnings.push('Its script was switched off in Arc, so it was left out (kept in the backup)');

    const known = new Set(['manifest.json', 'boost.config.json', ...cssPaths, ...jsPaths]);
    const extras = group.files.map(f => f.rel).filter(r => !known.has(r));
    if (extras.length) warnings.push('Has extra parts that can\'t be converted (' + extras.join(', ') + '); they are kept in the backup');

    const hasCss = hasRealCode(css);
    const hasJs = hasRealCode(js);
    if (!hasCss && !hasJs) warnings.push('No CSS or script found to convert');

    return {
      id: config.id || folderName,
      dir: group.dir,
      name: String(name).trim() || folderName,
      enabled: config.extensionEnabled !== false && manifest.enabled !== false,
      version: /^\d+(\.\d+){0,3}$/.test(manifest.version || '') ? manifest.version : '1.0.0',
      description: manifest.description || '',
      matches: matches.length ? matches : ['<all_urls>'],
      runAt: ['document_start', 'document_end', 'document_idle'].includes(runAt) ? runAt : 'document_idle',
      css: hasCss ? css : '',
      js: hasJs ? js : '',
      files: group.files,
      warnings
    };
  }

  /* ---------- outputs ---------- */

  function toStylus(boosts) {
    return boosts.filter(b => b.css).map(b => ({
      name: b.name + ' (Arc Boost)',
      enabled: b.enabled,
      sections: [Object.assign({ code: b.css }, appliesTo(b.matches))]
    }));
  }

  function toUserscript(b) {
    const runAt = { document_start: 'document-start', document_end: 'document-end', document_idle: 'document-idle' }[b.runAt];
    const head = [
      '// ==UserScript==',
      '// @name         ' + b.name.replace(/\n/g, ' ') + ' (Arc Boost)',
      '// @namespace    ' + NAMESPACE,
      '// @version      ' + b.version,
      '// @description  ' + (b.description ? b.description.replace(/\n/g, ' ') + ' — ' : '') + 'Converted from an Arc Boost by Arc Boost Rescue',
      ...b.matches.map(m => '// @match        ' + (m === '<all_urls>' ? '*://*/*' : m)),
      '// @run-at       ' + (b.css ? 'document-start' : runAt),
      '// @grant        none',
      '// ==/UserScript==',
      ''
    ];
    if (!b.enabled) head.push('// Note: this Boost was switched off in Arc.', '');
    const body = [];
    if (b.css) {
      body.push(
        '(function () {',
        '  const css = ' + JSON.stringify(b.css) + ';',
        '  const style = document.createElement(\'style\');',
        '  style.textContent = css;',
        '  (document.head || document.documentElement).appendChild(style);',
        '})();',
        ''
      );
    }
    if (b.js) {
      const wait = b.css && b.runAt !== 'document_start'
        ? (b.runAt === 'document_end' ? 'DOMContentLoaded' : 'load')
        : null;
      if (wait) {
        body.push(
          '// The Boost\'s own script, run when the page is ready (as in Arc)',
          '(function () {',
          '  const run = function () {',
          indent(b.js, 4),
          '  };',
          '  if (document.readyState === \'' + (wait === 'load' ? 'complete' : 'loading') + '\') ' +
            (wait === 'load' ? 'run();' : 'document.addEventListener(\'DOMContentLoaded\', run);'),
          '  else ' + (wait === 'load' ? 'window.addEventListener(\'load\', run);' : 'run();'),
          '})();',
          ''
        );
      } else {
        body.push('// The Boost\'s own script', '(function () {', indent(b.js, 2), '})();', '');
      }
    }
    return head.join('\n') + body.join('\n');
  }

  function indent(code, n) {
    const pad = ' '.repeat(n);
    return code.split('\n').map(l => (l ? pad + l : l)).join('\n');
  }

  function toChromeExtension(boosts) {
    const used = new Set();
    const files = [];
    const content_scripts = [];
    for (const b of boosts) {
      if (!b.enabled || (!b.css && !b.js)) continue;
      const slug = slugify(b.name, used);
      const entry = { matches: b.matches, run_at: b.runAt };
      if (b.css) { files.push({ path: 'boosts/' + slug + '/styles.css', data: b.css }); entry.css = ['boosts/' + slug + '/styles.css']; }
      if (b.js) { files.push({ path: 'boosts/' + slug + '/content.js', data: b.js }); entry.js = ['boosts/' + slug + '/content.js']; }
      content_scripts.push(entry);
    }
    const manifest = {
      manifest_version: 3,
      name: 'My Arc Boosts (rescued)',
      version: '1.0.0',
      description: 'Your Arc Boosts, converted by Arc Boost Rescue. Edit the files in the boosts folder to change them.',
      content_scripts
    };
    files.unshift({ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' });
    return { files, count: content_scripts.length };
  }

  function toReadme(boosts, counts) {
    const lines = [
      'arc boost rescue',
      '',
      boosts.length + ' boost' + (boosts.length === 1 ? '' : 's') + ', ' + new Date().toISOString().slice(0, 10) + '.',
      '',
      'easiest: install violentmonkey, open its dashboard > settings > import from zip,',
      'and pick the zip this folder came in. no unzipping needed.',
      '',
      "what's in here:",
      '  userscripts/          ' + counts.userscripts + ' file(s). what violentmonkey imports.',
      '  stylus-import.json    ' + counts.stylus + ' style(s). stylus > manage > import.',
      '  chromium-extension/   ' + counts.extension + ' boost(s). chrome://extensions > developer mode > load unpacked.',
      '                        keep the folder somewhere permanent.',
      '  original-backup/      your original boost folders, untouched.',
      '',
      'your boosts:'
    ];
    for (const b of boosts) {
      const parts = [sitesLabel(b.matches), b.css ? 'css' : null, b.js ? 'js' : null, b.enabled ? null : 'was off'].filter(Boolean).join(', ');
      lines.push('  - ' + b.name + ' (' + parts + ')');
      for (const w of b.warnings) lines.push('      note: ' + w.charAt(0).toLowerCase() + w.slice(1));
    }
    lines.push('', 'not affiliated with arc. ' + NAMESPACE, '');
    return lines.join('\n');
  }

  /* ---------- zip (store, no compression) ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(entries, date) {
    const d = date || new Date();
    const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.path);
      const data = toBytes(e.data);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cenSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  /* ---------- top level ---------- */

  function convert(files) {
    const groups = groupBoosts(files);
    const boosts = groups.map(parseBoost);
    const stylus = toStylus(boosts);
    const used = new Set();
    const userscripts = boosts.filter(b => b.css || b.js).map(b => ({
      path: 'userscripts/' + slugify(b.name, used) + '.user.js',
      data: toUserscript(b),
      boost: b
    }));
    const ext = toChromeExtension(boosts);
    const counts = { stylus: stylus.length, userscripts: userscripts.length, extension: ext.count };
    const stylusJson = JSON.stringify(stylus, null, 2) + '\n';
    const root = 'arc-boosts-rescued/';
    const entries = [
      { path: root + 'README.txt', data: toReadme(boosts, counts) },
      { path: root + 'stylus-import.json', data: stylusJson },
      ...userscripts.map(u => ({ path: root + u.path, data: u.data })),
      ...ext.files.map(f => ({ path: root + 'chromium-extension/' + f.path, data: f.data })),
      ...boosts.flatMap(b => b.files.map(f => ({
        path: root + 'original-backup/' + (b.dir.split('/').pop() || b.id) + '/' + f.rel,
        data: f.data
      })))
    ];
    return { boosts, stylus, stylusJson, userscripts, extension: ext, counts, zipEntries: entries };
  }

  const api = {
    convert, groupBoosts, parseBoost, toStylus, toUserscript, toChromeExtension, toReadme,
    appliesTo, matchToRegex, isValidMatch, sitesLabel, makeZip, crc32, slugify
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoostRescue = api;
})(typeof self !== 'undefined' ? self : this);
