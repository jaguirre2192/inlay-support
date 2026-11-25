// Tests atlas/js/friends.js's codec against the iPhone app's own encoder and decoder.
//
//   node tools/test-friends.mjs          # uses atlas/dev/friend-fixtures.json (made by tools/friend-codes.sh make)
//   node tools/test-friends.mjs --swift  # also feeds the web's codes to the app's decoder (needs swiftc)
//
// Node has CompressionStream/DecompressionStream('deflate-raw'), Intl.Segmenter and atob, as browsers do.

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';

const root = new URL('../atlas/', import.meta.url);
// friends.js imports Preact by bare name (the page's import map): map those names to the vendored files.
const map = { 'preact': 'vendor/preact.module.js', 'preact/hooks': 'vendor/hooks.module.js', 'htm': 'vendor/htm.module.js' };
registerHooks({ resolve: (spec, ctx, next) => (map[spec] ? { url: new URL(map[spec], root).href, shortCircuit: true } : next(spec, ctx)) });
const F = await import(new URL('js/friends.js', root));

const fixtures = JSON.parse(readFileSync(new URL('dev/friend-fixtures.json', root), 'utf8'));
let passed = 0;
const test = async (title, fn) => { try { await fn(); passed++; console.log('  ok  ', title); } catch (e) { console.log('  FAIL', title, '\n       ', e.message); process.exitCode = 1; } };
const plain = (s) => s && ({ name: s.name, visited: s.visited, ...(s.liveID ? { liveID: s.liveID } : {}) });
const refused = async (text) => { await assert.rejects(F.readInvite(text), /notAnInvite/); };

console.log('Codes the app wrote (its own SharedAtlas and LinkCode, compiled by tools/friend-codes.sh):');
for (const f of fixtures) {
  const code = f.inviteCode ?? f.code, label = typeof f.input === 'string' ? f.input : `${JSON.stringify(f.input.name)}, ${f.input.visited.length} places${f.input.liveID ? ', live' : ''}`;
  await test(`${label}: ${code.slice(0, 7)} code, link, message and app-scheme link read as the app reads them`, async () => {
    assert.deepEqual(plain(await F.readInvite(code)), f.read);
    if (f.url) assert.deepEqual(plain(await F.readInvite(f.url)), f.read);
    if (f.invitation) assert.deepEqual(plain(await F.readInvite(f.invitation)), f.read);
    assert.deepEqual(plain(await F.readInvite('hey! ' + code + ' see you')), f.read);
    assert.deepEqual(plain(await F.readInvite('inlay://friend?d=' + encodeURIComponent(code))), f.read);
    assert.deepEqual(plain(await F.openInviteFromURL({ hash: '#' + code, search: '' })), f.read);
    assert.deepEqual(plain(await F.openInviteFromURL({ hash: '', search: '?friend=' + encodeURIComponent(code) })), f.read);
  });
  if (f.json && f.code) await test(`${label}: the web writes the same JSON the app packs (keys in the web's fixed order)`, async () => {
    const swift = new TextDecoder().decode(await F.unpack(f.code.slice(7)));
    assert.deepEqual(JSON.parse(swift), JSON.parse(f.json), 'unpacks to what the app encoded');
    const v = F.validated(F.cleanName(f.input.name) || 'A friend', f.input.visited, f.input.liveID);
    const web = F.encodeShared(v);
    assert.deepEqual(JSON.parse(web), JSON.parse(swift));
    // Foundation's JSONEncoder writes keys in an unstable order; with the same order the bytes match.
    const reordered = JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(swift)).map((k) => [k, JSON.parse(web)[k]]))).replace(/\//g, '\\/');
    assert.equal(reordered, swift);
  });
}

console.log('Codes the web writes:');
const written = [];
const atlases = [
  ['Sam', ['ES', 'FR', 'GR', 'IT', 'JP', 'PE', 'VN', 'US']], ['  Jorge  ', ['IT', 'FR', 'PR']], ['Søren / Bø', ['DK', 'NO', 'IS']],
  ['佐藤 花子', ['JP', 'KR', 'TW', 'FR']], ['', ['FR']], ['Ana María', ['MX', 'ES', 'AR', 'IT-25']],
  ['Everywhere', fixtures.find((f) => f.input?.name === 'Everywhere').input.visited],
];
for (const [name, visited] of atlases) {
  await test(`${JSON.stringify(name)}: writeInvite makes an INLAY2 link that reads back`, async () => {
    const atlas = { name, visits: Object.fromEntries(visited.map((id) => [id, {}])) };
    const w = await F.writeInvite(atlas);
    assert.ok(w.code.startsWith('INLAY2-') && !w.code.includes('='));
    assert.equal(w.url, 'https://inlayatlas.com/friend/#' + w.code);
    assert.equal(w.invitation, 'Compare travel maps with me on Inlay\n' + w.url);
    const back = await F.readInvite(w.url);
    assert.deepEqual(back, F.validated(name || 'A friend', visited, null));
    written.push({ input: { name, visited }, code: w.code, url: w.url, invitation: w.invitation, expect: plain(back) });
  });
}
await test('An atlas of 1,000 places is refused by the writer, as the app refuses it', async () => {
  const visits = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => ['P' + i, {}]));
  await assert.rejects(F.writeInvite({ name: 'Big', visits }), /unpackable/);
});

console.log('Refusals and limits:');
await test('Garbage, foreign links and broken codes are refused', async () => {
  for (const text of ['hello', 'INLAY2-!!!!', 'INLAY2-', 'INLAY1-', 'INLAY3-abc', 'https://example.com/friend?d=x', 'INLAY2-AAAA', 'INLAY1-e30']) await refused(text);
});
await test('Unexpected place IDs are refused (the app’s hostile-ID test)', async () => {
  const hostile = JSON.stringify({ name: 'X', visited: ['<script>alert(1)</script>'] });
  await refused('INLAY2-' + await F.pack(new TextEncoder().encode(hostile)));
  await refused('INLAY2-' + await F.pack(new TextEncoder().encode(JSON.stringify({ name: 'Sam', visited: ['FR'], liveID: 'not/an/id' }))));
  await refused('INLAY2-' + await F.pack(new TextEncoder().encode(JSON.stringify({ name: '  ', visited: ['FR'] }))));
  await refused('INLAY2-' + await F.pack(new TextEncoder().encode(JSON.stringify({ name: 'Sam', visited: 'FR' }))));
});
const bomb = 'INLAY2-' + F.webSafe(deflateRawSync(Buffer.alloc(5_000_000, ' ')));
await test(`A code inflating past 200,000 bytes is refused, and reading stops early (${bomb.length} characters → 5 MB)`, async () => { await refused(bomb); });
const edge = 'INLAY2-' + F.webSafe(deflateRawSync(Buffer.from(JSON.stringify({ name: 'Edge', visited: ['FR'] }).padEnd(199_999, ' '))));
await test('JSON of 199,999 bytes is read; 200,000 is refused (json.count < maxInflated)', async () => {
  assert.equal((await F.readInvite(edge)).name, 'Edge');
  await refused('INLAY2-' + F.webSafe(deflateRawSync(Buffer.from(JSON.stringify({ name: 'Edge', visited: ['FR'] }).padEnd(200_000, ' ')))));
});
await test('A code longer than 24,000 characters is refused before decoding', async () => {
  await refused('INLAY2-' + 'A'.repeat(24_001));
  await refused('INLAY1-' + 'A'.repeat(24_001));
});
await test('cleanName: NFC, controls out, joiners kept, spaces collapsed, 40 characters', async () => {
  assert.equal(F.cleanName('  Jorge  '), 'Jorge');
  assert.equal(F.cleanName('Le\u0301a\u0007\u200B  \n Ana'), 'Léa Ana');
  assert.equal(F.cleanName('👩‍👩‍👧 family'), '👩‍👩‍👧 family');
  assert.equal(F.cleanName('x'.repeat(60)).length, 40);
  assert.equal([...new Intl.Segmenter().segment(F.cleanName('👩‍👩‍👧'.repeat(50)))].length, 40);
});

console.log('Friends and comparisons:');
await test('addFriend updates a friend by name and keeps them sorted (FriendsTests)', async () => {
  const a = { friends: [] };
  F.addFriend(a, { name: 'Sam', visited: ['FR'] }); F.addFriend(a, { name: 'Ana', visited: ['ES'] });
  F.addFriend(a, { name: 'sam', visited: ['FR', 'GR'] });
  assert.deepEqual(a.friends.map((f) => f.name), ['Ana', 'sam']);
  assert.deepEqual(a.friends[1].visited, ['FR', 'GR']);
  assert.match(a.friends[1].updated, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});
await test('A live invite keeps the places already known and replaces the same-name snapshot', async () => {
  const a = { friends: [] }, live = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
  F.addFriend(a, { name: 'Sam', visited: ['FR', 'IT'] });
  F.addFriend(a, { name: 'Sam', visited: [], liveID: live });
  assert.equal(a.friends.length, 1);
  assert.deepEqual(a.friends[0], { ...a.friends[0], name: 'Sam', visited: ['FR', 'IT'], liveID: live });
  assert.equal(F.friendID(a.friends[0]), live);
});
await test('compare splits places in atlas order (AtlasComparison)', async () => {
  assert.deepEqual(F.compare(new Set(['FR', 'IT', 'XX']), ['IT', 'ES', 'YY'], ['ES', 'FR', 'IT']), { both: ['IT'], onlyMine: ['FR'], onlyTheirs: ['ES'] });
});
await test('openInviteFromURL ignores pages without a code', async () => {
  assert.equal(await F.openInviteFromURL({ hash: '', search: '' }), null);
  assert.equal(await F.openInviteFromURL({ hash: '#about', search: '?x=1' }), null);
  assert.equal(await F.openInviteFromURL({ hash: '#INLAY2-garbage!', search: '' }), null);
});

if (process.argv.includes('--swift')) {
  console.log('The app’s decoder reading the web’s codes (tools/friend-codes.sh read):');
  const lines = written.flatMap((w) => [w.code, w.url, 'inlay://friend?d=' + w.code, w.invitation.replace(/\n/g, '\\n')]);
  const out = JSON.parse(execFileSync(new URL('friend-codes.sh', import.meta.url).pathname, ['read'], { input: lines.join('\n') + '\n' }).toString());
  for (const [i, w] of written.entries()) {
    await test(`${JSON.stringify(w.input.name)}: the app reads the web's code, link, app link and invitation`, async () => {
      for (let k = 0; k < 4; k++) assert.deepEqual(out[i * 4 + k].read, w.expect, lines[i * 4 + k].slice(0, 60));
    });
  }
  const refusedBySwift = JSON.parse(execFileSync(new URL('friend-codes.sh', import.meta.url).pathname, ['read'], { input: [bomb, 'INLAY2-' + 'A'.repeat(24_001)].join('\n') + '\n' }).toString());
  await test('The app refuses the same oversized codes', async () => { assert.ok(refusedBySwift.every((r) => r.read === null)); });
  const accepted = JSON.parse(execFileSync(new URL('friend-codes.sh', import.meta.url).pathname, ['read'], { input: edge + '\n' }).toString());
  await test('The app reads the 199,999-byte edge code too', async () => { assert.equal(accepted[0].read?.name, 'Edge'); });
}
console.log(`${passed} passed${process.exitCode ? ', some failed' : ''}`);
