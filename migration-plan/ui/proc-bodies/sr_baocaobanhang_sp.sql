-- PARAMS:
-- @tungay date
-- @denngay date

create PROC [dbo].[SR_BAOCAOBANHANG_SP]
(
	@tungay date,
	@denngay date
)
AS
BEGIN
	select a.soluong as soluongtra , a.id_Sanpham
	into #temp
	from sr_giamtrucongno_chitiet a
	left join sr_giamtrucongno b on a.id_giamtru = b.id
	where b.loaichungtu = 'HBBTL'  and b.active = 1

	select Top(10) c.tensp, (a.soluong - ISNULL(d.soluongtra,0)) as soluong 
	into #temp1
	from sr_banhang_chitiet a
	join sr_banhang b on a.id_banhang = b.id
	left join sr_sanpham c on a.id_Sanpham = c.id
	left join #temp d on a.id_Sanpham = d.id_Sanpham
	where b.active = 1  and b.loaichungtu = 'BHHDVTN' and  CAST(b.ngaytao as date) between @tungay and @denngay 

	select tensp,SUM(soluong )as soluong
	from #temp1 
	group by tensp
	ORDER BY soluong desc

	drop table #temp,#temp1
END
