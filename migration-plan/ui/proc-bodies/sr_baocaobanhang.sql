-- PARAMS:
-- @tungay date
-- @denngay date

create PROC [dbo].[SR_BAOCAOBANHANG]
(
	@tungay date,
	@denngay date
)
AS
BEGIN
	select Top(10) b.tenncc as tenkhachhang,
	(a.tongtienthanhtoan - ((Isnull(a.tralai_giamtru,0) + Isnull(a.giamgia_giamtru,0)) - (Isnull(a.giamgia_chitien,0) + Isnull(a.tralai_chitien,0)))) as 'tongtienhang' 
	into #temp
	from sr_banhang a
	join sr_nhacungcap b on a.id_khachhang = b.id
	where a.active = 1  and a.loaichungtu = 'BHHDVTN' and  CAST(a.ngaytao as date) between @tungay and @denngay 
	ORDER BY  (a.tongtienthanhtoan - ((Isnull(a.tralai_giamtru,0) + Isnull(a.giamgia_giamtru,0))
	- (Isnull(a.giamgia_chitien,0) + Isnull(a.tralai_chitien,0))))  desc


	select tenkhachhang,SUM(tongtienhang )as tongtienhang
	from #temp 
	group by tenkhachhang
	ORDER BY tongtienhang desc

	drop table #temp
END
