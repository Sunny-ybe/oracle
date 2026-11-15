// Run with node scripts/test-game.js. Uses synthetic records, never production writes.
import assert from 'node:assert/strict';
import { eligibleGameRounds, MIN_GAME_PHOTOS } from '../src/web/game.js';
const center = { lat: 33.418, lng: -111.934 };
const places = [{ id: 'near', name: 'Nearby test venue', ...center }, { id: 'far', name: 'Distant test venue', lat: 37.79, lng: -122.39 }];
function photo(i, placeId = 'near') {
  return {
    _id: `photo-${i}`, placeId, createdAt: '2026-11-14T20:00:00Z',
    question: {
      _id: `question-${i}`, placeId, status: 'resolved', topic: 'crowd', question: 'How crowded was it?',
      options: ['Empty', 'Some space', 'Packed'], result: { option: 2, source: 'people', votes: 3 },
      votes: [{ photoId: `photo-${i}`, option: 2, description: 'Several people seated in the room.' }],
      resolvedAt: '2026-11-14T20:01:00Z',
    },
  };
}
const eight = Array.from({ length: 8 }, (_, i) => photo(i));
assert.equal(eligibleGameRounds(eight, places, center).length, MIN_GAME_PHOTOS);
assert.equal(eligibleGameRounds(eight.slice(0, 7), places, center).length, 7);
assert.equal(eligibleGameRounds([photo(1, 'far')], places, center).length, 0);
assert.equal(eligibleGameRounds([photo(1), photo(1)], places, center).length, 1);
for (const invalidate of [
  p => { p.question.votes[0].option = 1; },
  p => { p.question.result.source = 'web'; },
  p => { p.question.votes = []; },
  p => { p.question.votes[0].description = 'Photo received (fully blurred for privacy).'; },
  p => { p.question.status = 'open'; },
  p => { p.question.topic = 'noise'; },
]) {
  const candidate = photo(10);
  invalidate(candidate);
  assert.equal(eligibleGameRounds([candidate], places, center).length, 0);
}
console.log('Crowd Guess checks passed: minimum photo count, location, unique evidence, winning answers, and rejected evidence.');
