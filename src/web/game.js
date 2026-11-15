import { PLACES } from '../config.js';
import { col } from '../db/mongo.js';
import { coordinates, distance } from './native.js';

export const MIN_GAME_PHOTOS = 8;
export const GAME_RADIUS_M = 3000;

// A round needs its own accepted photo, tied to the winning crowd report at a nearby place.
export function eligibleGameRounds(photos, places, center) {
  const nearby = new Map(places.filter(p => distance(center, p) <= GAME_RADIUS_M).map(p => [p.id, p]));
  const seenQuestions = new Set();
  const seenPhotos = new Set();
  const rounds = [];
  for (const photo of photos) {
    const q = photo.question;
    const place = nearby.get(photo.placeId);
    if (!place || !q || q.placeId !== place.id || q.status !== 'resolved' || !['crowd', 'people_count'].includes(q.topic)) continue;
    const answer = q.result?.option;
    if (![1, 2, 3].includes(answer) || !Array.isArray(q.options) || q.options.length !== 3 || !q.options.every(o => typeof o === 'string' && o.trim())) continue;
    if (!['people', 'photo'].includes(q.result.source)) continue;
    const vote = q.votes?.find(v => v.photoId === photo._id && v.option === answer && typeof v.description === 'string' && v.description.trim() && !v.description.includes('fully blurred for privacy'));
    if (!vote || !q.resolvedAt || !photo.createdAt || seenQuestions.has(q._id) || seenPhotos.has(photo._id)) continue;
    seenQuestions.add(q._id); seenPhotos.add(photo._id);
    rounds.push({
      id: q._id, place: place.name, placeId: place.id, lat: place.lat, lng: place.lng, kind: place.kind,
      question: q.question, options: q.options, answer, votes: q.result.votes || 0,
      source: q.result.source, at: q.resolvedAt,
      photoUrl: `/api/photos/${encodeURIComponent(photo._id)}`, photoId: photo._id,
      photoAt: photo.createdAt, evidence: vote.description,
    });
  }
  return rounds;
}

export async function gameRounds(query) {
  const center = coordinates(query.lat, query.lng);
  const ids = PLACES.filter(p => distance(center, p) <= GAME_RADIUS_M).map(p => p.id);
  if (!ids.length) return { minimumPhotos: MIN_GAME_PHOTOS, availablePhotos: 0, radiusM: GAME_RADIUS_M, rounds: [] };
  const photos = await col('photos').aggregate([
    { $match: { placeId: { $in: ids } } },
    { $sort: { createdAt: -1 } },
    { $project: { data: 0 } },
    { $lookup: { from: 'questions', localField: 'questionId', foreignField: '_id', as: 'question' } },
    { $unwind: '$question' },
  ]).toArray();
  const eligible = eligibleGameRounds(photos, PLACES, center);
  return {
    minimumPhotos: MIN_GAME_PHOTOS, availablePhotos: eligible.length, radiusM: GAME_RADIUS_M,
    rounds: eligible.length >= MIN_GAME_PHOTOS ? eligible.slice(0, MIN_GAME_PHOTOS) : [],
  };
}
