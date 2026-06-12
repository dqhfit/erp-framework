-- PARAMS:
-- @dexuat_id uniqueidentifier

CREATE PROC [dbo].[TR_DEXUAT_PHOI_CHITIET_GETALL3]
(
	@dexuat_id uniqueidentifier
)
AS
BEGIN
	SELECT dexuat_id,SUM(sokhoi_yc) AS Tongsokhoi_yc, Sum(sothanh_yc) as Tongsothanh_yc
	into #temp
	FROM tr_dexuat_phoi_chitiet 
	WHERE dexuat_id = @dexuat_id and IsCancel = 0
	group by dexuat_id
	
	--select * from #temp
	--drop table  #temp

	SELECT a.*,CONCAT(a.dayy_yc,'*',a.rong_yc, '*', a.dai_yc) as quycach,
			CONCAT(b.dayy,'*',b.rong,'*',b.dai) as quycach1,
			b.sothanh,
			b.sokhoi,
			b.ghichu as ghichu1,
			a.ghichu_yc,
			b.id_chitiet,
			c.loaigo,
			d.Tongsokhoi_yc,d.Tongsothanh_yc
	FROM tr_dexuat_phoi_chitiet a
	left join bg_donhang_chitiet b on a.id  = b.dexuat_id
	left join bg_xuatnhapgo c on b.id_chitiet = c.id
	left join #temp d on a.dexuat_id = d.dexuat_id
	WHERE a.dexuat_id = @dexuat_id and a.IsCancel = 0
	ORDER BY a.nguyenlieu,a.dayy_yc asc
	drop table #temp
END
