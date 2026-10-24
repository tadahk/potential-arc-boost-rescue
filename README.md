# arc boost rescue

arc shuts down dec 22 and says boosts can't be exported. they're just files on your mac (`~/Library/Application Support/Arc/boosts`), so this grabs them and turns them into:

- userscripts (violentmonkey, any browser)
- a stylus import file
- an unpacked extension for chrome/brave/edge/dia
- a backup of the originals

use it: https://tadahk.github.io/potential-arc-boost-rescue/

runs in your browser, no server. if a boost doesn't convert, open an issue.

tests: `node tests/test.js path/to/boosts`

MIT. not affiliated with arc.
