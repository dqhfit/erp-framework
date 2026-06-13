-- Cap so lan resume mot bang trong full-import job. Worker tang attempts moi
-- lan bat dau (running) mot bang. Bang bi interrupt lien tuc ma KHONG tien duoc
-- (rows_imported = 0) qua nguong -> tu dong danh skipped thay vi wedge ca job
-- mai mai (vd SYS_USER: bang auth ghi lien tuc, read bi khoa / worker bi restart
-- giua chung roi boot auto-resume lai dau tren no). Bai hoc #11 (skipped vs
-- failed) + #14 (auto-resume khong duoc lap vo han tren 1 bang chet).
ALTER TABLE migration_full_job_tables ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
