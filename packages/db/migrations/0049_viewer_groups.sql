CREATE TABLE IF NOT EXISTS viewer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_viewer_groups (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES viewer_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS page_viewer_groups (
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES viewer_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, group_id)
);
