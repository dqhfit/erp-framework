/* 0033_cdc_setup.sql -- CDC (Change Data Capture) setup cho Debezium /
   Postgres logical replication.

   YEU CAU SERVER POSTGRES -- chi chay duoc khi superuser. Migration se
   no-op neu role app khong co quyen:
   - wal_level = logical (postgresql.conf, restart can)
   - max_replication_slots >= 4
   - max_wal_senders >= 4

   Sau migration nay, set up Debezium connector:
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
   analytics, search index) tu pull. */

DO $$ BEGIN
  -- Try create publication; ignore neu permission denied (non-superuser).
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'erp_cdc_pub') THEN
    CREATE PUBLICATION erp_cdc_pub FOR TABLE
      entity_records, entity_record_versions, activity_log, audit_log_immutable;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'CDC setup bo qua -- role app khong co quyen CREATE PUBLICATION. Setup tay voi superuser neu can.';
WHEN OTHERS THEN
  RAISE NOTICE 'CDC setup loi: %', SQLERRM;
END $$;
