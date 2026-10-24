/* Arc Boost Rescue — page logic. Reads files locally; nothing is sent anywhere. */
(function () {
  'use strict';

  // Optional tip link, e.g. 'https://ko-fi.com/yourname'. Leave empty to hide.
  const TIP_URL = '';

  const $ = id => document.getElementById(id);
  const picker = $('picker');
  const drop = $('drop');
  const status = $('status');
  let result = null;

  if (TIP_URL) {
    const tip = $('tip');
    const a = document.createElement('a');
    a.href = TIP_URL;
    a.rel = 'noopener';
    a.textContent = 'Did this save your Boosts? Buy me a coffee';
    tip.appendChild(a);
    tip.classList.remove('hidden');
  }

  $('copy-path').addEventListener('click', async () => {
    const text = $('boost-path').textContent;
    try {
      await navigator.clipboard.writeText(text);
      $('copy-path').textContent = 'Copied';
      setTimeout(() => { $('copy-path').textContent = 'Copy'; }, 1500);
    } catch (e) {
      const r = document.createRange();
      r.selectNodeContents($('boost-path'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  });

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function readFileList(list) {
    const files = [];
    for (const f of list) {
      const path = f.webkitRelativePath || f._relPath || f.name;
      if (f.size > 5 * 1024 * 1024) continue; // Boost files are tiny; skip anything huge
      files.push({ path, data: new Uint8Array(await f.arrayBuffer()) });
    }
    return files;
  }

  function walkEntry(entry, prefix, out) {
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(f => { f._relPath = prefix + f.name; out.push(f); resolve(); }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const next = () => reader.readEntries(async batch => {
          if (!batch.length) {
            for (const e of all) await walkEntry(e, prefix + entry.name + '/', out);
            resolve();
          } else {
            all.push(...batch);
            next();
          }
        }, () => resolve());
        next();
      } else resolve();
    });
  }

  async function handle(fileObjects) {
    try {
      setStatus('Reading your Boosts…');
      const files = await readFileList(fileObjects);
      result = BoostRescue.convert(files);
      if (!result.boosts.length) {
        $('results').classList.add('hidden');
        setStatus('No Boosts found in that folder. Make sure you chose the "boosts" folder itself (the path in step 1).', 'warn');
        return;
      }
      setStatus('Found ' + result.boosts.length + ' Boost' + (result.boosts.length === 1 ? '' : 's') + '. Nothing was uploaded.', 'ok');
      render();
    } catch (e) {
      console.error(e);
      setStatus('Something went wrong reading those files: ' + e.message, 'warn');
    }
  }

  function render() {
    const { boosts, counts } = result;
    const withWarnings = boosts.filter(b => b.warnings.length).length;
    $('summary').textContent = counts.userscripts + ' ready to install' +
      (withWarnings ? ', ' + withWarnings + ' with a note to check (shown below)' : '') + '.';
    const list = $('boost-list');
    list.textContent = '';
    for (const b of boosts) {
      const li = document.createElement('li');
      const top = document.createElement('div');
      top.className = 'b-top';
      const name = document.createElement('strong');
      name.textContent = b.name;
      const site = document.createElement('span');
      site.className = 'site';
      site.textContent = BoostRescue.sitesLabel(b.matches);
      top.append(name, site);
      const tags = document.createElement('div');
      tags.className = 'tags';
      for (const [on, label] of [[b.css, 'CSS'], [b.js, 'Script'], [!b.enabled, 'Was off in Arc']]) {
        if (!on) continue;
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = label;
        tags.appendChild(t);
      }
      li.append(top, tags);
      for (const w of b.warnings) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = w;
        li.appendChild(p);
      }
      list.appendChild(li);
    }
    $('dl-stylus').disabled = !counts.stylus;
    $('results').classList.remove('hidden');
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  $('dl-zip').addEventListener('click', () => {
    if (result) download(BoostRescue.makeZip(result.zipEntries), 'arc-boosts-rescued.zip', 'application/zip');
  });
  $('dl-stylus').addEventListener('click', () => {
    if (result) download(result.stylusJson, 'stylus-import.json', 'application/json');
  });

  picker.addEventListener('change', () => {
    if (picker.files && picker.files.length) handle([...picker.files]);
  });

  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', async e => {
    e.preventDefault();
    const items = [...(e.dataTransfer.items || [])];
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) {
      const out = [];
      for (const en of entries) await walkEntry(en, '', out);
      handle(out);
    } else if (e.dataTransfer.files.length) {
      handle([...e.dataTransfer.files]);
    }
  });
})();
