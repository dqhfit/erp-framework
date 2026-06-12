-- PARAMS:
-- @donhang nvarchar
-- @masp nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar


CREATE   PROC [dbo].[TR_PALLET_GETNEWORDER2]
(
	@donhang nvarchar(200),
	@masp nvarchar(200),
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50)
)
AS
BEGIN TRANSACTION
BEGIN TRY

DECLARE @soluong_donhang int;
SELECT @soluong_donhang = SUM(A.order_qty)
FROM tr_order_detail A
WHERE A.order_number = @donhang AND item_number = @masp AND A.f_cancelled = 'N'

DECLARE @mact NVARCHAR(50)
DECLARE @stt NVARCHAR(50)
DECLARE @chitiet NVARCHAR(200)
DECLARE @id_nguyenlieu NVARCHAR(50)
DECLARE @nguyenlieu NVARCHAR(50)
DECLARE @dayy_tc float
DECLARE @rong_tc float
DECLARE @dai_tc float
DECLARE @soluong_tc int
DECLARE @dayy_sc float
DECLARE @rong_sc float
DECLARE @dai_sc float
DECLARE @soluong_sc int
DECLARE @m3_tc float

DECLARE @ghichu nvarchar(max)
DECLARE	@veneer_matchinh int
DECLARE	@veneer_matphu int
DECLARE	@bemat nvarchar(50)
DECLARE	@somat_giacong int
DECLARE	@cc_canh1 bit
DECLARE @cc_canh2 bit
DECLARE @cc_dau1 bit
DECLARE @cc_dau2 bit
DECLARE @cc_mat1 bit
DECLARE @cc_mat2 bit
DECLARE @dayy_phoi float
DECLARE @pcode nvarchar(50)

DECLARE CUR CURSOR LOCAL FOR
	SELECT mact, stt, chitiet, id_nguyenlieu, nguyenlieu, 
		dayy_tc, rong_tc, dai_tc, soluong_tc, m3_tc,
		dayy_sc, rong_sc, dai_sc, soluong_sc,
		ghichu, veneer_matchinh, veneer_matphu,
		bemat, somat_giacong,
		cc_canh1, cc_canh2, cc_dau1, cc_dau2, cc_mat1, cc_mat2,
		dayy_phoi, pcode
	FROM tr_dinhmuc_govan
	WHERE masp = @masp AND mact <> '000'
OPEN CUR
FETCH NEXT FROM CUR INTO @mact, @stt, @chitiet, @id_nguyenlieu, @nguyenlieu, 
						@dayy_tc, @rong_tc, @dai_tc, @soluong_tc, @m3_tc,
						@dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
						@ghichu, @veneer_matchinh, @veneer_matphu,
						@bemat, @somat_giacong,
						@cc_canh1, @cc_canh2, @cc_dau1, @cc_dau2, @cc_mat1, @cc_mat2,
						@dayy_phoi, @pcode
WHILE @@FETCH_STATUS = 0
BEGIN
	IF EXISTS (SELECT id FROM tr_pallet WHERE donhang = @donhang AND masp = @masp AND mact = @mact AND isOrderNumber = 1)
	BEGIN
		-- select * from tr_pallet
		UPDATE tr_pallet
		SET stt = @stt,
			tenct = @chitiet,
			nguyenlieu = @nguyenlieu,
			id_nguyenlieu = @id_nguyenlieu,
			dayy_tc = @dayy_tc,
			rong_tc = @rong_tc,
			dai_tc = @dai_tc,
			soluong_tc = @soluong_tc,
			dayy_sc = @dayy_sc,
			rong_sc = @rong_sc,
			dai_sc = @dai_sc,
			soluong_sc = @soluong_sc,
			soluong_donhang = @soluong_donhang,
			soluong_can = @soluong_tc * @soluong_donhang,
			sokhoi_tinhche = @m3_tc * @soluong_donhang,
			ngaysua = @ngaysua,
			nguoisua = @nguoisua,
			ghichu = @ghichu,
			veneer_matchinh = @veneer_matchinh,
			veneer_matphu = @veneer_matphu,
			bemat = @bemat,
			somat_giacong = @somat_giacong,
			cc_canh1 = @cc_canh1,
			cc_canh2 = @cc_canh2,
			cc_dau1 = @cc_dau1,
			cc_dau2 = @cc_dau2,
			cc_mat1 = @cc_mat1,
			cc_mat2 = @cc_mat2,
			dayy_phoi = @dayy_phoi,
			pcode = @pcode
		WHERE donhang = @donhang AND masp = @masp AND mact = @mact AND isOrderNumber = 1
	END
	ELSE
	BEGIN
		INSERT INTO tr_pallet
		(
			masp, stt, mact, tenct, nguyenlieu,
			dayy_tc, rong_tc, dai_tc, soluong_tc,
			dayy_sc, rong_sc, dai_sc, soluong_sc,
			soluong_donhang, soluong_can, sokhoi_tinhche,
			isCreateCard, ngaytao, nguoitao, ngaysua, nguoisua,
			active, ghichu, veneer_matchinh, veneer_matphu, bemat, somat_giacong,
			cc_canh1, cc_canh2, cc_dau1, cc_dau2, cc_mat1, cc_mat2, dayy_phoi,
			id_nguyenlieu, donhang, isOrderNumber, pcode
		)
		VALUES
		(
			@masp, @stt, @mact, @chitiet, @nguyenlieu,
			@dayy_tc, @rong_tc, @dai_tc, @soluong_tc,
			@dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
			@soluong_donhang, @soluong_tc * @soluong_donhang, @m3_tc * @soluong_donhang,
			0, @ngaytao, @nguoitao, @ngaysua, @nguoisua,
			1, @ghichu, @veneer_matchinh, @veneer_matphu, @bemat, @somat_giacong,
			@cc_canh1, @cc_canh2, @cc_dau1, @cc_dau2, @cc_mat1, @cc_mat2, @dayy_phoi,
			@id_nguyenlieu, @donhang, 1, @pcode
		)
	END
FETCH NEXT FROM CUR INTO @mact, @stt, @chitiet, @id_nguyenlieu, @nguyenlieu, 
						@dayy_tc, @rong_tc, @dai_tc, @soluong_tc, @m3_tc,
						@dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
						@ghichu, @veneer_matchinh, @veneer_matphu,
						@bemat, @somat_giacong,
						@cc_canh1, @cc_canh2, @cc_dau1, @cc_dau2, @cc_mat1, @cc_mat2,
						@dayy_phoi, @pcode
END
CLOSE CUR
DEALLOCATE CUR

	COMMIT TRANSACTION
END TRY
BEGIN CATCH
	ROLLBACK TRANSACTION
END CATCH

SELECT * 
FROM tr_pallet A
WHERE A.donhang = @donhang AND A.masp = @masp AND A.mact <> '000'
	AND A.isOrderNumber = 1

