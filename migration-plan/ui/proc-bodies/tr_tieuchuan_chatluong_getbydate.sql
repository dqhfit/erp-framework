-- PARAMS:
-- @ngaythang date


CREATE   PROC [dbo].[TR_TIEUCHUAN_CHATLUONG_GETBYDATE]
(
	@ngaythang date
)
AS
BEGIN
SELECT A.Id,
	A.ngay, 
	C.tieuchi, 
	C.tieuchuan, C.Id AS matieuchuan, 
	C.dungcu,
	D.dondathang, D.masp, D.mahtr, D.mact, D.tenct, D.nguyenlieu, 
	D.dayy_tc, D.rong_tc, D.dai_tc,
	A.manguoilam, A.CreatedBy, A.CreatedOn,
	A.congdoan, 
	A.ketqua, 
	soluongkiem = (A.soluongdat + A.soluongloi),
	A.soluongdat, A.soluongloi,
	C.ghichu,
	A.pallet_id, A.sauxuly, F.[Name] AS nguyennhan,
	A.soluongChiTietloi,
	A.TieuChuanLoi
INTO #BAOCAOLOI
FROM tr_tieuchuan_chatluong A
	INNER JOIN tr_tieuchuan_congdoan B ON A.tieuchuancongdoan = B.Id
	INNER JOIN tr_tieuchuan C ON B.tieuchuan = C.Id
	INNER JOIN tr_pallet D ON A.pallet_id = D.id
	LEFT JOIN tr_tieuchuan_nguyennhan F ON A.nguyennhan = F.Id
WHERE A.ngay = @ngaythang
ORDER BY D.masp, D.mact, C.stt

SELECT A.*, C.TenLoi, E.donhang AS donhangsudung
FROM #BAOCAOLOI A
	LEFT JOIN tr_tieuchuan_loi_detail B ON A.TieuChuanLoi = B.Id
	LEFT JOIN tr_tieuchuan_loi C ON B.DanhMucLoi = C.Id
	LEFT JOIN tr_tieuchuan D ON B.tieuchuan = D.Id
	LEFT JOIN tr_dondathang E ON A.dondathang = E.maddh

--SELECT c.tieuchuan,b.TenLoi, a.Id 
--FROM tr_tieuchuan_loi_detail a
--	INNER JOIN tr_tieuchuan_loi b on a.DanhMucLoi = b.Id
--	INNER JOIN tr_tieuchuan c on a.tieuchuan = c.Id

DROP TABLE #BAOCAOLOI;
END

