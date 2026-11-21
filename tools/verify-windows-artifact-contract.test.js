'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const readRoot = (...pathParts) =>
  readFileSync(join(ROOT, ...pathParts), 'utf8').replace(/\r\n/g, '\n');

const BUILDER_YAML = readRoot('electron-builder.yaml');
const RELEASE_WORKFLOW = readRoot('.github', 'workflows', 'build.yml');

const sectionValue = (sectionName, key) => {
  const lines = BUILDER_YAML.split('\n');
  const sectionStart = lines.indexOf(`${sectionName}:`);
  assert.notEqual(sectionStart, -1, `${sectionName} section not found`);

  for (let index = sectionStart + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^\S/.test(line)) {
      break;
    }
    const match = line.match(new RegExp(`^  ${key}:\\s*(\\S+)\\s*$`));
    if (match) {
      return match[1];
    }
  }

  assert.fail(`${key} not found in ${sectionName}`);
};

test('Windows release builds x64 portable artifact', () => {
  assert.equal(
    sectionValue('portable', 'artifactName'),
    'Super-Productivity-Portable-x64.${ext}',
  );
});

test('Windows workflow builds x64 portable exe and zip layout', () => {
  assert.match(RELEASE_WORKFLOW, /electron-builder --win --x64 --publish never/);
  assert.match(RELEASE_WORKFLOW, /node tools\/build-windows-portable\.js \.tmp\/app-builds/);
  assert.match(RELEASE_WORKFLOW, /Super-Productivity-Portable-x64\.zip/);
  assert.match(RELEASE_WORKFLOW, /Super-Productivity-Portable-x64\.exe/);
});

test('build-windows-portable.js exports expected helpers and builds valid ICO header', () => {
  const { buildIcoFromPngs, buildWindowsPortableLayout } = require('./build-windows-portable.js');
  assert.equal(typeof buildWindowsPortableLayout, 'function');
  const ico = buildIcoFromPngs([
    join(ROOT, 'build', 'icons', '16x16.png'),
    join(ROOT, 'build', 'icons', '32x32.png'),
    join(ROOT, 'build', 'icons', '256x256.png'),
  ]);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
});
