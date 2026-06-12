-- PARAMS:
-- @ngaythang date
-- @dondathang nvarchar
-- @masp nvarchar
-- @congdoan nvarchar
-- @pallet_id int


CREATE   PROC [dbo].[TR_TIEUCHUAN_CHATLUONG_GETALL4]
(
	@ngaythang date,
	@dondathang nvarchar(100),
	@masp nvarchar(200),
	@congdoan nvarchar(50),
	@pallet_id int
)
AS
SELECT A.ngay, C.tieuchi, C.tieuchuan, C.dungcu,
	D.dondathang, D.masp, D.mahtr, D.mact, D.tenct, D.nguyenlieu, 
	D.dayy_tc, D.rong_tc, D.dai_tc,
	A.manguoilam, 
	A.CreatedBy, E.FullName, A.CreatedOn,
	A.congdoan, 
	A.ketqua, 
	soluongkiem = (A.soluongdat + A.soluongloi),
	A.soluongdat, A.soluongloi,
	C.ghichu, A.pallet_id,
	A.sauxuly, F.[Name] AS nguyennhan,
	A.huongxuly
FROM tr_tieuchuan_chatluong A
	INNER JOIN tr_tieuchuan_congdoan B ON A.tieuchuancongdoan = B.Id
	INNER JOIN tr_tieuchuan C ON B.tieuchuan = C.Id
	INNER JOIN tr_pallet D ON A.pallet_id = D.id
	LEFT JOIN SYS_USER E ON A.CreatedBy = E.UserName
	LEFT JOIN tr_tieuchuan_nguyennhan F ON A.nguyennhan = F.Id
WHERE D.dondathang = @dondathang 
	AND D.mahtr = @masp 
	AND A.ngay = @ngaythang
	AND A.congdoan = @congdoan
	AND A.pallet_id = @pallet_id

