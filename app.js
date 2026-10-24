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
    a.textContent = 'tip jar';
    tip.append(' · ', a);
    tip.classList.remove('hidden');
  }

  $('copy-path').addEventListener('click', async () => {
    const text = $('boost-path').textContent;
    try {
      await navigator.clipboard.writeText(text);
      $('copy-path').textContent = 'copied';
      setTimeout(() => { $('copy-path').textContent = 'copy'; }, 1500);
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
      setStatus('reading…');
      const files = await readFileList(fileObjects);
      result = BoostRescue.convert(files);
      if (!result.boosts.length) {
        $('results').classList.add('hidden');
        setStatus('no boosts in there. pick the boosts folder itself.', 'warn');
        return;
      }
      setStatus('found ' + result.boosts.length + ' boost' + (result.boosts.length === 1 ? '' : 's') + '.', 'ok');
      render();
    } catch (e) {
      console.error(e);
      setStatus('that broke: ' + e.message, 'warn');
    }
  }

  function render() {
    const { boosts } = result;
    const notes = boosts.filter(b => b.warnings.length).length;
    $('summary').textContent = 'ok, got them' + (notes ? ' (' + notes + ' with a note)' : '') + ':';
    const list = $('boost-list');
    list.textContent = '';
    for (const b of boosts) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = b.name + ' ';
      const meta = document.createElement('span');
      meta.className = 'site';
      const bits = [BoostRescue.sitesLabel(b.matches), b.css ? 'css' : '', b.js ? 'js' : '', b.enabled ? '' : 'was off']
        .filter(Boolean).join(' · ');
      meta.textContent = '— ' + bits;
      li.append(name, meta);
      for (const w of b.warnings) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = '↳ ' + w.charAt(0).toLowerCase() + w.slice(1);
        li.appendChild(p);
      }
      list.appendChild(li);
    }
    $('dl-stylus').disabled = !result.counts.stylus;
    $('results').classList.remove('hidden');
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
