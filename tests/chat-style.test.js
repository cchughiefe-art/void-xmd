import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalChatStyle } from '../src/chat-style.js';
test('chat voice uses only the selected account examples and preserves truthful identity', () => {
  const primary = naturalChatStyle({ personality: 'Brief and calm', styleExamples: 'MY_PRIVATE_VOICE_EXAMPLE' });
  const secondary = naturalChatStyle({ personality: 'Formal English' });
  assert.match(primary, /MY_PRIVATE_VOICE_EXAMPLE/);
  assert.ok(!secondary.includes('MY_PRIVATE_VOICE_EXAMPLE'));
  assert.match(primary, /Do not claim to be human/);
  assert.match(primary, /not a reason to switch to Pidgin/);
  assert.match(primary, /only if it helps/);
  assert.ok(naturalChatStyle({ styleExamples: 'x'.repeat(8000) }).length < 11000);
});
test('learned samples are bounded, account-specific and can be disabled', () => {
  const learnedTone = Array.from({ length: 40 }, (_, i) => ({ id: String(i), text: `sample-${i}` }));
  const prompt = naturalChatStyle({ learnedTone });
  assert.ok(!prompt.includes('sample-0\n'));
  assert.ok(prompt.includes('sample-39'));
  assert.ok(!naturalChatStyle({ learnTone: false, learnedTone }).includes('sample-39'));
  assert.ok(!naturalChatStyle({}).includes('sample-39'));
});
