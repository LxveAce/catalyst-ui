import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { parseGitHubUrl, resolveGitBinary } from './git-service';

test('parseGitHubUrl: SSH form (with and without .git)', () => {
  assert.deepEqual(parseGitHubUrl('git@github.com:LxveAce/catalyst-ui.git'), {
    owner: 'LxveAce',
    repo: 'catalyst-ui',
  });
  assert.deepEqual(parseGitHubUrl('git@github.com:LxveAce/catalyst-ui'), {
    owner: 'LxveAce',
    repo: 'catalyst-ui',
  });
});

test('parseGitHubUrl: HTTPS form (token, .git, and trailing path all tolerated)', () => {
  const want = { owner: 'LxveAce', repo: 'catalyst-ui' };
  assert.deepEqual(parseGitHubUrl('https://github.com/LxveAce/catalyst-ui'), want);
  assert.deepEqual(parseGitHubUrl('https://github.com/LxveAce/catalyst-ui.git'), want);
  assert.deepEqual(parseGitHubUrl('https://x-access-token:tok@github.com/LxveAce/catalyst-ui.git'), want);
  assert.deepEqual(parseGitHubUrl('https://github.com/LxveAce/catalyst-ui/tree/main'), want);
});

test('parseGitHubUrl: ssh:// URL form', () => {
  assert.deepEqual(parseGitHubUrl('ssh://git@github.com/LxveAce/catalyst-ui.git'), {
    owner: 'LxveAce',
    repo: 'catalyst-ui',
  });
});

test('parseGitHubUrl: non-GitHub / empty input returns null', () => {
  assert.equal(parseGitHubUrl(null), null);
  assert.equal(parseGitHubUrl(undefined), null);
  assert.equal(parseGitHubUrl(''), null);
  assert.equal(parseGitHubUrl('https://gitlab.com/a/b'), null);
  assert.equal(parseGitHubUrl('not a url'), null);
});

test('resolveGitBinary: resolves to an absolute path or null, never a bare name', () => {
  // The CAT-A1 hardening: git must resolve to an ABSOLUTE path from PATH (or null when not found),
  // never a bare "git"/"git.exe" that Windows CreateProcess could pick up from an attacker-controlled cwd.
  const g = resolveGitBinary();
  assert.ok(g === null || path.isAbsolute(g), `expected an absolute path or null, got ${g}`);
  if (g !== null) {
    assert.notEqual(g, 'git');
    assert.notEqual(g, 'git.exe');
  }
});
