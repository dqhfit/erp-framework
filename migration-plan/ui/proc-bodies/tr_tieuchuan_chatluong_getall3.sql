-- PARAMS:
-- @ngaythang date
-- @dondathang nvarchar
-- @masp nvarchar
-- @congdoan nvarchar


CREATE   PROC [dbo].[TR_TIEUCHUAN_CHATLUONG_GETALL3]
(
	@ngaythang date,
	@dondathang nvarchar(100),
	@masp nvarchar(200),
	@congdoan nvarchar(50)
)
AS
SELECT A.ngay, C.tieuchi, C.tieuchuan, C.dungcu,
	D.dondathang, D.masp, D.mahtr, D.mact, D.tenct, D.nguyenlieu, 
	D.dayy_tc, D.rong_tc, D.dai_tc,
	A.manguoilam, A.CreatedBy, A.CreatedOn,
	A.congdoan, 
	A.ketqua, 
	soluongkiem = (A.soluongdat + A.soluongloi),
	A.soluongdat, A.soluongloi,
	C.ghichu, A.pallet_id
FROM tr_tieuchuan_chatluong A
	INNER JOIN tr_tieuchuan_congdoan B ON A.tieuchuancongdoan = B.Id
	INNER JOIN tr_tieuchuan C ON B.tieuchuan = C.Id
	INNER JOIN tr_pallet D ON A.pallet_id = D.id
WHERE D.dondathang = @dondathang 
	AND D.mahtr = @masp
	AND A.ngay = @ngaythang
	AND A.congdoan = @congdoan
ORDER BY D.mact, C.stt

