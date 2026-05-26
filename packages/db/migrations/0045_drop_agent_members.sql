-- 0045_drop_agent_members.sql — Drop agent_members table sau khi
-- resource_members (P2.3, migration 0044) trở thành nguồn sự thật.
--
-- Tiền điều kiện: migration 0044 đã apply (backfill agent_members →
-- resource_members WITH resource_type='agent'). Mọi code đọc/ghi đã
-- migrate sang resource_members qua resource-acl.ts (P2.4).
--
-- Defensive: backfill lại 1 lần nữa trước khi drop, phòng case có
-- row mới được thêm vào agent_members trong khoảng thời gian giữa
-- 0044 và 0045 (vd rollback dual-write code). Idempotent qua ON CONFLICT.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'agent_members'
  ) THEN
    -- Safety net: backfill row mới nếu có
    INSERT INTO resource_members (
      resource_type, resource_id, user_id, role, added_by, added_at
    )
    SELECT 'agent', agent_id, user_id, role::text,
           COALESCE(added_by, user_id), added_at
      FROM agent_members
    ON CONFLICT DO NOTHING;

    DROP TABLE agent_members;
  END IF;

  -- pgEnum agent_member_role có thể đã bị drop kèm CASCADE từ bảng,
  -- nhưng vẫn cố gắng drop để clean schema.
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_member_role') THEN
    DROP TYPE agent_member_role;
  END IF;
END $$;
