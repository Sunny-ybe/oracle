-- Tiger Data schema. Run once in the Tiger Cloud SQL editor.

-- Every answer from a person, a verified photo, or the web.
CREATE TABLE IF NOT EXISTS answers (
  time           TIMESTAMPTZ NOT NULL DEFAULT now(),
  question_id    TEXT        NOT NULL,
  place_id       TEXT        NOT NULL,
  topic          TEXT        NOT NULL,   -- stable key, e.g. line_length, crowd, pizza_left
  option         SMALLINT    NOT NULL,   -- 1 = lowest ... 3 = highest
  answer_text    TEXT,
  question_text  TEXT,
  user_id        TEXT,
  trust          REAL,
  source         TEXT        NOT NULL DEFAULT 'people'   -- people | photo | web
);
SELECT create_hypertable('answers', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS answers_lookup ON answers (place_id, topic, time DESC);

-- Every payout, for the dashboard and totals.
CREATE TABLE IF NOT EXISTS payouts (
  time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     TEXT        NOT NULL,
  amount_sol  DOUBLE PRECISION NOT NULL,
  reason      TEXT,
  signature   TEXT,
  url         TEXT
);
SELECT create_hypertable('payouts', 'time', if_not_exists => TRUE);

-- Hourly rollup for long-range trends (refreshed automatically every 15 minutes).
CREATE MATERIALIZED VIEW IF NOT EXISTS answers_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket, place_id, topic,
       avg(option)::float AS avg_option, count(*) AS n
FROM answers
GROUP BY bucket, place_id, topic
WITH NO DATA;

SELECT add_continuous_aggregate_policy('answers_hourly',
  start_offset => INTERVAL '7 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE);
