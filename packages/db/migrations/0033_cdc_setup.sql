/* 0033_cdc_setup.sql — CDC (Change Data Capture) setup cho Debezium /
   Postgres logical replication.

   YÊU CẦU SERVER POSTGRES — chỉ chạy được khi superuser. Migration sẽ
   no-op nếu role app không có quyền:
   - wal_level = logical (postgresql.conf, restart cần)
   - max_replication_slots >= 4
   - max_wal_senders >= 4

   Sau migration này, set up Debezium connector:
   curl -X POST http://debezium:8083/connectors -H "Content-Type: application/json" -d '{
     "name": "erp-connector",
     "config": {
       "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
       "database.hostname": "db",
       "database.dbname": "erp_framework",
       "publication.name": "erp_cdc_pub",
       "slot.name": "erp_cdc_slot"
     }
   }'
   Event stream sang Kafka topic, downstream consumer (data warehouse,
   analytics, search index) tự pull. */

DO $$ BEGIN
  -- Try create publication; ignore nếu permission denied (non-superuser).
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'erp_cdc_pub') THEN
    CREATE PUBLICATION erp_cdc_pub FOR TABLE
      entity_records, entity_record_versions, activity_log, audit_log_immutable;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'CDC setup bỏ qua — role app không có quyền CREATE PUBLICATION. Setup tay với superuser nếu cần.';
WHEN OTHERS THEN
  RAISE NOTICE 'CDC setup lỗi: %', SQLERRM;
END $$;
