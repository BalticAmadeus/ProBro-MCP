import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pfPath = path.resolve(__dirname, '../resources/oe/scripts/oe.pf');

test('startup profile avoids UTF-8 codepage to keep local runtime booting on this environment', () => {
  const pf = fs.readFileSync(pfPath, 'utf8');

  assert.match(pf, /-cpinternal\s+ISO8859-1/i);
  assert.doesNotMatch(pf, /-cpinternal\s+UTF-8/i);
  assert.doesNotMatch(pf, /-cpstream\s+UTF-8/i);
});
