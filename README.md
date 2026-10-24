# Arc Boost Rescue

**Save your Arc Boosts before Arc shuts down on December 22, 2026.**

Arc's help centre says Boosts can't be exported and won't move to Dia. They are still on your Mac as plain files, though, and this page converts them for other browsers.

**Use it:** https://tadahk.github.io/potential-arc-boost-rescue/

## What you get

One zip containing:

| Folder / file | For |
|---|---|
| `userscripts/` | Violentmonkey or Tampermonkey, in any browser (Zen, Firefox, Chrome, Brave, Edge, Dia, Safari via the Userscripts app). Each Boost's CSS and JavaScript in one script. |
| `stylus-import.json` | The Stylus extension: every Boost's CSS, ready for Stylus › Manage › Import. |
| `chromium-extension/` | Chrome, Brave, Edge, Dia, Vivaldi: all enabled Boosts as one unpacked extension. |
| `original-backup/` | Your untouched Boost folders. |
| `README.txt` | A list of your Boosts, anything to check, and install steps. |

## How it works

On a Mac, Arc stores each Boost in `~/Library/Application Support/Arc/boosts/<id>/` as a small extension: `manifest.json` (which sites it runs on), `boost.config.json` (name, on/off), `styles.css` and `content.js`. The page reads that folder in your browser and rewrites each Boost into the formats above.

- **Private by design.** No server, no analytics, and a Content Security Policy that blocks all network connections from the page.
- **Honest about gaps.** Rare extras inside a Boost (a pop-up or background script) can't be converted; they're kept in the backup and flagged. Boosts made for Arc's own pages are flagged too.

## Develop

No build step. Open `index.html`, or serve the folder with any static server.

```
node tests/test.js path/to/folder-of-boosts
```

The converter (`converter.js`) has no dependencies and also runs in Node.

## Found a Boost that didn't convert?

Open an issue and, if you're comfortable, attach that Boost's folder from `original-backup` (check it has nothing private first).

---

MIT licence. Not affiliated with The Browser Company.
