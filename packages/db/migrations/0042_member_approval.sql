/* 0042_member_approval.sql -- Phe duyet thanh vien dang ky qua invite link chung.
   Them cot approved vao company_members.
   - DEFAULT true  : thanh vien cu + thanh vien duoc them truc tiep (addMember) deu approved.
   - false         : nguoi dung tu dang ky qua generic invite link -- phai cho admin duyet.
   Khi approved=false: AuthGate hien man hinh "cho phe duyet", moi RBAC procedure bi block. */

ALTER TABLE "company_members" ADD COLUMN IF NOT EXISTS "approved" boolean NOT NULL DEFAULT true;
