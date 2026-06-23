-- Quyen truy cap trang per-user (uu tien hon nhom)
-- User co trong bang nay luon thay trang du khong thuoc nhom nao.
CREATE TABLE IF NOT EXISTS user_page_access (
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  page_id    uuid NOT NULL REFERENCES pages(id)    ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);

CREATE INDEX IF NOT EXISTS user_page_access_company_idx ON user_page_access(company_id);
CREATE INDEX IF NOT EXISTS user_page_access_user_idx    ON user_page_access(user_id);
CREATE INDEX IF NOT EXISTS user_page_access_page_idx    ON user_page_access(page_id);
