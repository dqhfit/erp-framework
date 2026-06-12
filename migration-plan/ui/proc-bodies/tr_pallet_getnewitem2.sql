-- PARAMS:
-- @dondathang nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoisua nvarchar
-- @ngaysua datetime


CREATE PROC [dbo].[TR_PALLET_GETNEWITEM2]
(
	@dondathang nvarchar(200),
	@nguoitao nvarchar(50),
	@ngaytao datetime,
	@nguoisua nvarchar(50),
	@ngaysua datetime
)
AS
BEGIN
--DECLARE @dondathang nvarchar(200) = 'DQH-VFM01/0324';
--DECLARE @nguoitao nvarchar(50);
--DECLARE @ngaytao datetime;
--DECLARE @nguoisua nvarchar(50);
--DECLARE @ngaysua datetime


DECLARE @masp nvarchar(200) = '';
DECLARE @mahtr nvarchar(200) = '';
DECLARE @soluong int = 0;
DECLARE @donhang nvarchar(max) = '';

DECLARE CUR CURSOR LOCAL FOR
	SELECT masp, chitiet, SUM(soluong) AS soluong, donhang = STRING_AGG(B.donhang, ',')
	FROM tr_dondathang_chitiet B 
	WHERE B.maddh = @dondathang
	GROUP BY masp, chitiet--, A.donhang
OPEN CUR
FETCH NEXT FROM CUR INTO @masp, @mahtr, @soluong, @donhang
WHILE @@FETCH_STATUS = 0
BEGIN
	IF ISNULL(@masp, '') = ''
	BEGIN
		SET @masp = dbo.ufn_MaHTR_To_MaSP(@mahtr)
	END

	DECLARE @mact NVARCHAR(50) = '000'
	DECLARE @stt NVARCHAR(50) = '000'
	DECLARE @tensp NVARCHAR(200) = ''
	DECLARE @dayy_tc float = 0
	DECLARE @rong_tc float = 0
	DECLARE @dai_tc float = 0
	DECLARE @soluong_tc int = 1
	DECLARE @dayy_sc float = 0
	DECLARE @rong_sc float = 0
	DECLARE @dai_sc float = 0
	DECLARE @soluong_sc int = 0
	DECLARE @m3_tc float = 0;

	SELECT @tensp = tensp, @dayy_tc = dai, @rong_tc = rong, @dai_tc = cao, @m3_tc = m3_tc
	FROM tr_sanpham WHERE masp = @masp

	DECLARE @cnt int
	SELECT @cnt = COUNT(id) FROM tr_pallet
	WHERE dondathang = @dondathang AND mahtr = @mahtr AND mact = '000'

	IF @cnt = 0
	BEGIN
		INSERT INTO tr_pallet
		(
			dondathang, masp, mahtr, stt, mact, tenct, 
			id_nguyenlieu, nguyenlieu,
			dayy_tc, rong_tc, dai_tc, soluong_tc, sokhoi_tinhche,
			dayy_sc, rong_sc, dai_sc, soluong_sc,
			soluong_donhang, soluong_can, isCreateCard, active,
			nguoitao, ngaytao, nguoisua, ngaysua, donhang
		)
		VALUES
		(
			@dondathang, @masp, @mahtr, @stt, @mact, @tensp,
			NULL, NULL,
			@dayy_tc, @rong_tc, @dai_tc, @soluong_tc, @m3_tc * @soluong,
			@dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
			@soluong, @soluong, 0, 1,
			@nguoitao, @ngaytao, @nguoisua, @ngaysua, @donhang
		)
	END
	ELSE
	BEGIN
		UPDATE tr_pallet
		SET tenct = @tensp,
			dayy_tc = @dayy_tc,
			rong_tc = @rong_tc,
			dai_tc = @dai_tc,
			sokhoi_tinhche = @m3_tc * @soluong,
			soluong_donhang = @soluong,
			soluong_can = @soluong,
			ngaysua = @ngaysua,
			nguoisua = @nguoisua,
			donhang = @donhang
		WHERE dondathang = @dondathang AND mahtr = @mahtr AND mact = '000' 
			-- AND isCreateCard = 0
		
	END
	FETCH NEXT FROM CUR INTO @masp, @mahtr, @soluong, @donhang
END
CLOSE CUR;
DEALLOCATE CUR;


SELECT * 
FROM tr_pallet A
WHERE A.dondathang = @dondathang
	AND mact = '000'

END
