-- TimescaleDB-Einrichtung; idempotent, wird nach jeder Migration ausgeführt.
CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('readings', by_range('ts', INTERVAL '7 days'), if_not_exists => TRUE, migrate_data => TRUE);

ALTER TABLE readings SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'meter_id, quantity',
  timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('readings', INTERVAL '7 days', if_not_exists => TRUE);
