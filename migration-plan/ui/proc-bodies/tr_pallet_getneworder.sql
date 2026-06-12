-- PARAMS:
-- @donhang nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar


CREATE   PROC [dbo].[TR_PALLET_GETNEWORDER]
(
	@donhang nvarchar(200),
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50)
)
AS
BEGIN
BEGIN TRANSACTION
BEGIN TRY

DECLARE @soluong int;
DECLARE @masp nvarchar(200);
DECLARE @tensp nvarchar(max);
DECLARE @dai float, @rong float, @cao float, @sokhoi float;


DECLARE CUR CURSOR LOCAL FOR
	SELECT A.item_number, A.[description], B.dai, B.rong, B.cao, B.m3_tc, SUM(A.order_qty) 
	FROM tr_order_detail A
		INNER JOIN tr_sanpham B ON A.item_number = B.masp
	WHERE A.order_number = @donhang AND A.f_cancelled = 'N'
	GROUP BY A.item_number, A.[description], B.dai, B.rong, B.cao, B.m3_tc
OPEN CUR
FETCH NEXT FROM CUR INTO @masp, @tensp, @dai, @rong, @cao, @sokhoi, @soluong
WHILE @@FETCH_STATUS = 0
BEGIN
	IF EXISTS (SELECT id FROM tr_pallet WHERE donhang = @donhang AND masp = @masp AND isOrderNumber = 1 AND mact = '000')
	BEGIN
		UPDATE tr_pallet
		SET soluong_donhang = @soluong,
			soluong_can = @soluong,
			sokhoi_tinhche = @sokhoi * @soluong,
			ngaysua = @ngaysua,
			nguoisua = @nguoisua
		WHERE donhang = @donhang AND masp = @masp AND isOrderNumber = 1
	END
	ELSE
	BEGIN
		INSERT INTO tr_pallet
		(
			donhang, 
			isOrderNumber, 
			masp, tenct, mact,
			dayy_tc, rong_tc, dai_tc, soluong_tc, sokhoi_tinhche,
			soluong_donhang, 
			soluong_can, 
			isCreateCard, 
			ngaytao, 
			nguoitao, 
			ngaysua, 
			nguoisua, 
			active
		)
		VALUES
		(
			@donhang, 
			1, 
			@masp, @tensp, '000',
			@dai, @rong, @cao, 1, @sokhoi * @soluong,
			@soluong,
			@soluong, 
			0, 
			@ngaytao,
			@nguoitao,
			@ngaysua, 
			@nguoisua, 
			1
		)
	END
	PRINT CONCAT(@MASP, ' - ', @soluong);
	FETCH NEXT FROM CUR INTO @masp, @tensp, @dai, @rong, @cao, @sokhoi, @soluong
END
CLOSE CUR
DEALLOCATE CUR
	COMMIT TRANSACTION
	PRINT 'COMMIT TRANSACTION'
END TRY
BEGIN CATCH
	ROLLBACK TRANSACTION
	PRINT 'ROLLBACK TRANSACTION'
END CATCH

SELECT A.*, B.tensp, B.tensp_vn, B.mausac, B.hehang, B.quycach
FROM tr_pallet A
	INNER JOIN tr_sanpham B ON A.masp = B.masp
WHERE A.donhang = @donhang --AND A.masp = @masp
	AND A.isOrderNumber = 1
	AND A.mact = '000'
END
