/*
 * Freeze the approved preview's transparent SVG compositions for native capture.
 * Run with @resvg/resvg-js available to Node and the preview checkout as argv[2].
 * This is build-time rendering: no SVG filters or image downloads during capture.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { Resvg } = require('@resvg/resvg-js');

const preview = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the approved recording-preview checkout');
const source = fs.readFileSync(path.join(preview, 'dist/app.js'), 'utf8');
const { guides, guideScenes } = vm.runInNewContext(
  source.split('const screens=')[0] + '; ({ guides, guideScenes })',
);
const output = path.resolve(__dirname, '../assets/recording-guides');
fs.mkdirSync(output, { recursive: true });
for (const [id, guide] of Object.entries(guides)) {
  const svg = guide
    .replaceAll('class="generated-fill"', 'opacity="0.70"')
    .replaceAll('class="generated-contour"', 'opacity="1"')
    .replace(/href="(assets\/[^"]+)"/g, (_, asset) =>
      `href="data:image/png;base64,${fs.readFileSync(path.join(preview, 'dist', asset)).toString('base64')}"`,
    );
  fs.writeFileSync(path.join(output, `${id}.png`), new Resvg(svg, {
    fitTo: { mode: 'width', value: 1170 },
  }).render().asPng());
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  previewCommit: execFileSync('git', ['-C', preview, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  opacity: { outline: 1, inside: 0.70, outside: 0.40 },
  aspectRatio: { width: 390, height: 844 },
  scenes: guideScenes,
}, null, 2) + '\n');
console.log(`Rendered ${Object.keys(guides).length} local recording guides`);
