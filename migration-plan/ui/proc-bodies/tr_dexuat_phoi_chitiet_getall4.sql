-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TR_DEXUAT_PHOI_CHITIET_GETALL4]
AS
BEGIN
    select b.sophieu,b.ngaycanphoi,
	a.id,a.dexuat_id,a.nguyenlieu,a.nguongoc,a.chatluong_yc,a.dayy_yc,a.rong_yc,a.dai_yc,a.sothanh_yc,
	a.sokhoi_yc,a.ghichu_giao,a.sokhoi_giao,a.ngaygiaophoi 
	from tr_dexuat_phoi_chitiet a
	left join tr_dexuat_phoi b on a.dexuat_id = b.id
	where	b.nguoiky <> '' and 
			b.ngayky is not null and
			b.ngaygiaophoi is null and
			b.IsCancel = 0 and
			b.IsFinish = 0 and 
			a.IsCancel = 0 and
			a.IsFinish = 0
	order by a.nguyenlieu,a.dayy_yc asc
END






