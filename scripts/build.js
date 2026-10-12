// Builds three archives into dist/:
//   tokenlens-chrome-<v>.zip   Chrome / Edge / Brave
//   tokenlens-firefox-<v>.zip  Firefox
//   tokenlens-source-<v>.zip   full open-source repo (tests, scripts, docs)
//
// Only the manifest differs between the two browser builds.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const v = manifest.version;
const RUNTIME = ['icons', 'src', 'popup', 'LICENSE', 'README.md', 'PRIVACY.md'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function stage(name, mutate) {
  const dir = path.join(dist, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const item of RUNTIME) fs.cpSync(path.join(root, item), path.join(dir, item), { recursive: true });
  const m = structuredClone(manifest);
  mutate(m);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  return dir;
}

function zip(cwd, out, args) {
  execFileSync('zip', ['-rqX', out, ...args], { cwd });
  console.log(`  ${path.relative(root, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

// Chrome: service worker only, no Firefox-specific settings.
const chrome = stage('chrome', (m) => {
  m.background = { service_worker: 'src/background.js' };
  delete m.browser_specific_settings;
});
zip(chrome, path.join(dist, `tokenlens-chrome-${v}.zip`), ['.']);

// Firefox: background scripts only, plus the add-on ID and the data
// collection declaration that addons.mozilla.org requires.
const firefox = stage('firefox', (m) => {
  m.background = { scripts: ['src/background.js'] };
  delete m.minimum_chrome_version;
  m.browser_specific_settings.gecko.data_collection_permissions = { required: ['none'] };
});
zip(firefox, path.join(dist, `tokenlens-firefox-${v}.zip`), ['.']);

// Source: everything tracked, nothing generated.
zip(root, path.join(dist, `tokenlens-source-${v}.zip`), [
  '.',
  '-x', 'dist/*', 'node_modules/*', '*.zip', '.DS_Store',
]);
