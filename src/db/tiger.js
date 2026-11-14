// Tiger Data: every answer and payout as time-series. Powers memory, trends and insights.
import pg from "pg";
import { env } from "../config.js";

const pool = new pg.Pool({ connectionString: env.tigerUrl });
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);

export async function checkTiger() {
  await q("SELECT 1");
  console.log("Tiger Data connected");
}

export const saveAnswer = (a) =>
  q(
    `INSERT INTO answers (question_id, place_id, topic, option, answer_text, question_text, user_id, trust, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [a.questionId, a.placeId, a.topic, a.option, a.answerText, a.questionText, a.userId || null, a.trust ?? null, a.source || "people"]
  );

export const savePayout = (p) =>
  q(`INSERT INTO payouts (user_id, amount_sol, reason, signature, url) VALUES ($1,$2,$3,$4,$5)`, [
    p.userId, p.amountSol, p.reason, p.signature, p.url,
  ]);

// Memory: a fresh, agreed answer for this place and topic.
export async function recentConsensus(placeId, topic, minutes) {
  const rows = await q(
    `SELECT option, max(answer_text) AS answer_text, count(*)::int AS n,
            sum(coalesce(trust, 1))::float AS weight, max(time) AS last_time,
            bool_or(source = 'photo') AS has_photo
     FROM answers
     WHERE place_id = $1 AND topic = $2 AND source <> 'web'
       AND time > now() - make_interval(mins => $3)
     GROUP BY option ORDER BY weight DESC LIMIT 1`,
    [placeId, topic, minutes]
  );
  const r = rows[0];
  return r && (r.n >= 3 || r.has_photo) ? r : null;
}

// Last 24 h in 15-minute buckets.
export const trend = (placeId, topic, hours = 24) =>
  q(
    `SELECT time_bucket('15 minutes', time) AS bucket,
            round(avg(option)::numeric, 2)::float AS avg_option, count(*)::int AS n
     FROM answers
     WHERE place_id = $1 AND topic = $2 AND time > now() - make_interval(hours => $3)
     GROUP BY bucket ORDER BY bucket`,
    [placeId, topic, hours]
  );

// "Usually worst at 12:00": average by hour of day over the last week (Phoenix time).
export const busiestHours = (placeId, topic) =>
  q(
    `SELECT extract(hour FROM time AT TIME ZONE 'America/Phoenix')::int AS hour,
            round(avg(option)::numeric, 2)::float AS avg_option, count(*)::int AS n
     FROM answers
     WHERE place_id = $1 AND topic = $2 AND time > now() - interval '7 days'
     GROUP BY hour HAVING count(*) >= 2
     ORDER BY avg_option DESC LIMIT 3`,
    [placeId, topic]
  );

export const topicsForPlace = (placeId) =>
  q(
    `SELECT topic, count(*)::int AS n, max(question_text) AS question
     FROM answers WHERE place_id = $1 GROUP BY topic ORDER BY n DESC`,
    [placeId]
  );

export const recentPayouts = () =>
  q(`SELECT time, user_id, amount_sol, reason, url FROM payouts ORDER BY time DESC LIMIT 15`);

export async function payoutTotal() {
  const [r] = await q(`SELECT coalesce(sum(amount_sol), 0)::float AS sol, count(*)::int AS n FROM payouts`);
  return r;
}
