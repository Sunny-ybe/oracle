// Spot scans: an earner's phone measures Wi-Fi speed (1 MB download), 10 seconds of loudness,
// and which floor they're on. Scans per floor turn into "2nd floor is good, 3rd floor is bad".
// A typed floor isn't trusted on its own. The phone must be at the building (GPS). A floor is "confirmed"
// by any one of: a photo of a floor sign or room number that Gemini reads (works with a single person),
// the phone's altitude fitting the building's learned ground level, or another person's matching scan.
// A sign or altitude that contradicts the claimed floor rejects the scan. Unconfirmed scans earn 1 point, confirmed 3.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { findPlace, PLACES } from "./config.js";
import * as mongo from "./db/mongo.js";
import { events } from "./core.js";
import { readFloorSign } from "./ai/gemini.js";

export const SCAN_POINTS = 3;
const FRESH_HOURS = Number(process.env.FLOOR_HOURS || 3);

// The 1 MB test file lives on this server, so the test measures the phone's real connection to Oracle.
export function ensureSpeedFile(publicDir) {
  const file = path.join(publicDir, "speedtest.bin");
  if (!fs.existsSync(file) || fs.statSync(file).size !== 1024 * 1024) fs.writeFileSync(file, randomBytes(1024 * 1024));
  return file;
}

export const floorName = (f) => {
  if (f === 0) return "Basement";
  if (f === 1) return "1st floor";
  if (f === 2) return "2nd floor";
  if (f === 3) return "3rd floor";
  return `${f}th floor`;
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const num = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? clamp(Number(v), lo, hi) : null);

const FLOOR_M = 3.6;                       // typical height of one floor
const level = (f) => (f === 0 ? -1 : f - 1); // basement -1, 1st floor (ground) 0, 2nd 1, ...
const haversineM = (a, b, c, d) => {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

// The building's ground-level altitude, learned from earlier altitude-checked scans by different people.
// Compared only against phones of the same kind, since iPhones and Android phones measure altitude from different baselines.
async function groundAltitude(placeId, platform, exceptUser) {
  const rows = await mongo.col("scans").find({ placeId, platform, altitude: { $ne: null }, altAcc: { $lte: 10 }, status: { $ne: "rejected" } })
    .sort({ at: -1 }).limit(40).toArray();
  const byUser = new Map();
  for (const r of rows) if (r.userId !== exceptUser && !byUser.has(r.userId)) byUser.set(r.userId, r.altitude - level(r.floor) * FLOOR_M);
  return byUser.size >= 2 ? { ground: median([...byUser.values()]), people: byUser.size } : null;
}

// Two people on the same floor agree if their noise is within 8 dB and their Wi-Fi within 3x.
const agrees = (a, b) =>
  (a.db == null || b.db == null || Math.abs(a.db - b.db) <= 8) &&
  (a.mbps == null || b.mbps == null || Math.max(a.mbps, b.mbps) / Math.max(0.5, Math.min(a.mbps, b.mbps)) <= 3) &&
  (a.db != null && b.db != null || a.mbps != null && b.mbps != null);

export async function saveScan(user, body) {
  const p = findPlace(body.placeId || user.placeId);
  if (!p) throw new Error("Pick the place you're at.");
  const floor = Math.round(Number(body.floor));
  if (!Number.isFinite(floor) || floor < 0 || floor > 60) throw new Error("Pick your floor.");

  // 1. You have to be there.
  const lat = num(body.lat, -90, 90), lng = num(body.lng, -180, 180), acc = num(body.accuracy, 0, 100000);
  if (lat == null || lng == null) throw new Error("Allow location so Oracle can confirm you're at the place.");
  const away = haversineM(lat, lng, p.lat, p.lng);
  const allowed = (p.radiusM || 150) + 100 + Math.min(acc ?? 0, 100);
  if (away > allowed) throw new Error(`You need to be at ${p.name} to scan it. You're about ${away > 1609 ? `${(away / 1609.34).toFixed(1)} mi` : `${Math.round(away)} m`} away.`);

  // 2. No spamming: one scan per floor every 5 minutes, and at least a minute between floors (time to actually move).
  const sameFloor = await mongo.col("scans").findOne({ userId: user._id, placeId: p.id, floor, at: { $gt: new Date(Date.now() - 5 * 60e3) } });
  if (sameFloor) throw new Error(`You scanned the ${floorName(floor).toLowerCase()} a few minutes ago. Try another floor, or come back in 5 minutes.`);
  const justNow = await mongo.col("scans").findOne({ userId: user._id, placeId: p.id, at: { $gt: new Date(Date.now() - 60e3) } });
  if (justNow) throw new Error("You just scanned. Give it a minute to get to the next floor.");

  const scan = {
    _id: randomUUID().slice(0, 10), userId: user._id, name: user.name, placeId: p.id, floor,
    mbps: num(body.mbps, 0, 5000), pingMs: num(body.pingMs, 0, 10000),
    db: num(body.db, 20, 120), peakDb: num(body.peakDb, 20, 130),
    altitude: num(body.altitude, -500, 9000), altAcc: num(body.altAcc, 0, 10000),
    platform: /iphone|ipad|ipod/i.test(String(body.ua || "")) ? "ios" : "other",
    lat, lng, distanceM: Math.round(away), at: new Date(), status: "unconfirmed", checks: [],
  };
  if (scan.mbps == null && scan.db == null) throw new Error("Run the Wi-Fi or noise test first.");

  // 3. Floor-sign photo: one person can prove their floor on their own. The photo itself is never stored.
  const sign = String(body.signImage || "").replace(/^data:[^,]+,/, "");
  if (sign) {
    let r = null;
    try { r = await readFloorSign({ base64: sign, mime: "image/jpeg", place: p }); }
    catch (e) { console.error("Floor sign check failed:", e.message); }
    if (r && r.real_photo === false) {
      throw new Error("That looks like a screenshot or a photo of a screen. Take a photo of a real floor sign, elevator panel or room number.");
    }
    if (r && Number.isInteger(r.floor)) {
      if (r.floor !== floor) {
        scan.status = "rejected"; scan.checks.push("sign-mismatch"); scan.signEvidence = r.evidence;
        await mongo.col("scans").insertOne(scan);
        throw new Error(`Your photo shows ${r.evidence || `the ${floorName(r.floor).toLowerCase()}`}, which is the ${floorName(r.floor).toLowerCase()}, not the ${floorName(floor).toLowerCase()}. Pick the right floor and scan again.`);
      }
      scan.status = "confirmed"; scan.checks.push("sign"); scan.signEvidence = r.evidence;
    } else if (r) scan.signEvidence = "no floor number visible";
  }

  // 4. Altitude cross-check against the building's learned ground level.
  const g = scan.altitude != null && scan.altAcc != null && scan.altAcc <= 10 ? await groundAltitude(p.id, scan.platform, user._id) : null;
  if (g) {
    const est = Math.round((scan.altitude - g.ground) / FLOOR_M);
    const estFloor = est < 0 ? 0 : est + 1;
    const off = Math.abs(est - level(floor));
    if (off >= 2) {
      scan.status = "rejected";
      await mongo.col("scans").insertOne(scan);
      throw new Error(`Your phone's altitude puts you on the ${floorName(estFloor).toLowerCase()}, not the ${floorName(floor).toLowerCase()}. Check your floor and scan again.`);
    }
    if (off === 0) { scan.status = "confirmed"; scan.checks.push("altitude"); }
  }

  // 5. Someone else's recent scan on the same floor agrees with yours (a bonus as more people join).
  const peers = await mongo.col("scans").find({ placeId: p.id, floor, userId: { $ne: user._id }, status: { $ne: "rejected" },
    at: { $gt: new Date(Date.now() - FRESH_HOURS * 3600e3) } }).toArray();
  const match = peers.filter((x) => agrees(x, scan));
  if (match.length) {
    scan.status = "confirmed"; scan.checks.push("people");
    // Their scans are confirmed too now, and they get the rest of their points.
    const lift = match.filter((x) => x.status !== "confirmed");
    if (lift.length) {
      await mongo.col("scans").updateMany({ _id: { $in: lift.map((x) => x._id) } }, { $set: { status: "confirmed" }, $addToSet: { checks: "people" } });
      for (const x of lift) await mongo.addCredits(x.userId, SCAN_POINTS - 1);
    }
  }

  await mongo.col("scans").insertOne(scan);
  const points = scan.status === "confirmed" ? SCAN_POINTS : 1;
  await mongo.addCredits(user._id, points);
  const report = await floorReport(p.id);
  events.emit("event", { type: "scan", at: new Date().toISOString(), placeId: p.id, place: p.name, name: user.name,
    floor: floorName(floor), mbps: scan.mbps, db: scan.db, status: scan.status, summary: report.summary });
  const why = scan.checks.includes("sign") ? `your photo shows ${scan.signEvidence || "that floor"}`
    : scan.checks.includes("altitude") ? "your altitude matches that floor"
    : scan.checks.includes("people") ? `${match.length === 1 ? "another person" : `${match.length} other people`} measured the same there` : null;
  return {
    ok: true, points, status: scan.status,
    message: scan.status === "confirmed" ? `Confirmed: ${why}.`
      : scan.signEvidence === "no floor number visible" ? "Saved as unconfirmed: no floor number was visible in your photo. Next time, photograph a floor sign, elevator panel or room number for 3 points."
      : "Saved as unconfirmed. Add a photo of a floor sign or room number to confirm it and earn 3 points.",
    report,
  };
}

// Wi-Fi: 100+ Mbps is great, 10 is fine, under 2 is poor (log scale). Noise: 45 dB is library quiet, 75 is loud.
const wifiScore = (m) => (m == null ? null : clamp(Math.log10(Math.max(m, 0.5)) / 2, 0, 1));
const quietScore = (d) => (d == null ? null : clamp((75 - d) / 30, 0, 1));
const wifiWord = (m) => (m >= 50 ? "fast Wi-Fi" : m >= 10 ? "decent Wi-Fi" : "slow Wi-Fi");
const noiseWord = (d) => (d < 55 ? "quiet" : d < 68 ? "a bit noisy" : "loud");

export async function floorReport(placeQuery) {
  const p = findPlace(placeQuery) || PLACES.find((x) => x.name.toLowerCase().includes(String(placeQuery || "").toLowerCase()));
  if (!p) return { place: placeQuery, floors: [], summary: `No floor scans for "${placeQuery}" yet.` };
  const since = new Date(Date.now() - FRESH_HOURS * 3600e3);
  const rows = await mongo.col("scans").aggregate([
    { $match: { placeId: p.id, at: { $gt: since }, status: { $ne: "rejected" } } },
    { $group: { _id: "$floor", scans: { $sum: 1 }, people: { $addToSet: "$userId" }, mbps: { $avg: "$mbps" }, db: { $avg: "$db" }, pingMs: { $avg: "$pingMs" },
      confirmed: { $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] } }, last: { $max: "$at" } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  const floors = rows.map((r) => {
    const mbps = r.mbps == null ? null : Math.round(r.mbps * 10) / 10;
    const db = r.db == null ? null : Math.round(r.db);
    const parts = [wifiScore(mbps), quietScore(db)].filter((x) => x != null);
    const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
    const verdict = score >= 0.6 ? "good" : score < 0.4 ? "bad" : "okay";
    const why = [db != null ? `${noiseWord(db)} (${db} dB)` : null, mbps != null ? `${wifiWord(mbps)} (${mbps} Mbps)` : null].filter(Boolean).join(" and ");
    return { floor: r._id, name: floorName(r._id), scans: r.scans, people: (r.people || []).length, confirmed: r.confirmed > 0,
      mbps, db, pingMs: r.pingMs == null ? null : Math.round(r.pingMs), score: Math.round(score * 100), verdict, why, last: r.last };
  });

  const sure = floors.filter((f) => f.confirmed);
  const pool = sure.length >= 2 ? sure : floors;
  const caveat = sure.length >= 2 ? "" : " (not confirmed yet: these floors have one unverified scan each)";
  let summary;
  if (!floors.length) summary = `No one has scanned ${p.name} in the last ${FRESH_HOURS} hours.`;
  else if (pool.length === 1) summary = `${pool[0].name} at ${p.name} is ${pool[0].verdict}: ${pool[0].why}${pool[0].confirmed ? "" : " (not confirmed yet)"}. Scan another floor to compare.`;
  else {
    const sorted = [...pool].sort((a, b) => b.score - a.score);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    summary = `${best.name} is the best at ${p.name} right now: ${best.why}. ${worst.name} is the worst: ${worst.why}${caveat}.`;
  }
  return { place: p.name, placeId: p.id, hours: FRESH_HOURS, floors, summary };
}
