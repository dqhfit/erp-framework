-- PARAMS:
-- @dondathang nvarchar
-- @mahtr nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoisua nvarchar
-- @ngaysua datetime

CREATE   PROC [dbo].[TR_PALLET_GETNEWITEM]
(
	@dondathang nvarchar(50), 
	@mahtr nvarchar(50),
	@nguoitao nvarchar(50),
	@ngaytao datetime,
	@nguoisua nvarchar(50),
	@ngaysua datetime
)
AS
BEGIN
DECLARE @masp nvarchar(200);
DECLARE @soluong_dathang float;
DECLARE @donhang_sudung nvarchar(max);

BEGIN TRY
	IF EXISTS (SELECT id FROM tr_dondathang_chitiet WHERE maddh = @dondathang AND chitiet = @mahtr)
	BEGIN
		SELECT @masp = masp, @soluong_dathang = soluong, @donhang_sudung = donhang
		FROM (
			SELECT B.masp, SUM(B.soluong) AS soluong, donhang = STRING_AGG(B.donhang, ',')
			FROM tr_dondathang_chitiet B 
			WHERE B.maddh = @dondathang AND B.chitiet = @mahtr
			GROUP BY B.masp--, A.donhang
		) A

		IF ISNULL(@masp, '') = ''
		BEGIN
			SET @masp = dbo.ufn_MaHTR_To_MaSP(@mahtr)
		END
	
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
		DECLARE	@veneer_dan_canh int
		DECLARE	@veneer_canhdai int
		DECLARE	@veneer_canhngan int
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

		DECLARE CUR CURSOR FOR
			SELECT mact, pcode, stt, chitiet, id_nguyenlieu, nguyenlieu, 
				dayy_tc, rong_tc, dai_tc, soluong_tc, m3_tc,
				dayy_sc, rong_sc, dai_sc, soluong_sc,
				ghichu, veneer_matchinh, veneer_matphu,
				bemat, somat_giacong,
				cc_canh1, cc_canh2, cc_dau1, cc_dau2, cc_mat1, cc_mat2,
				dayy_phoi, veneer_canhdai, veneer_canhngan, veneer_dan_canh
			FROM tr_dinhmuc_govan
			WHERE masp = @masp AND mact <> '000'
		OPEN CUR
		FETCH NEXT FROM CUR INTO @mact, @pcode, @stt, @chitiet, @id_nguyenlieu, @nguyenlieu, 
								 @dayy_tc, @rong_tc, @dai_tc, @soluong_tc, @m3_tc,
								 @dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
								 @ghichu, @veneer_matchinh, @veneer_matphu,
								 @bemat, @somat_giacong,
								 @cc_canh1, @cc_canh2, @cc_dau1, @cc_dau2, @cc_mat1, @cc_mat2,
								 @dayy_phoi, @veneer_canhdai, @veneer_canhngan, @veneer_dan_canh
		WHILE @@FETCH_STATUS = 0
		BEGIN
			DECLARE @cnt int
			SELECT @cnt = COUNT(id) FROM tr_pallet
			WHERE dondathang = @dondathang AND masp = @masp AND mact = @mact
			
			DECLARE @sokhoi_tinhche float = 0;
			SET @sokhoi_tinhche = @m3_tc * @soluong_dathang;

			IF @cnt = 0
			BEGIN
				INSERT INTO tr_pallet
				(
					dondathang, masp, mahtr, stt, mact, pcode, tenct, 
					id_nguyenlieu, nguyenlieu,
					dayy_tc, rong_tc, dai_tc, soluong_tc, sokhoi_tinhche,
					dayy_sc, rong_sc, dai_sc, soluong_sc,
					soluong_donhang, soluong_can, isCreateCard, active,
					nguoitao, ngaytao, nguoisua, ngaysua,
					ghichu, veneer_matchinh, veneer_matphu,
					bemat, somat_giacong, donhang,
					cc_canh1, cc_canh2, cc_dau1, cc_dau2, cc_mat1, cc_mat2, dayy_phoi,
					veneer_canhdai, veneer_canhngan, veneer_dan_canh
				)
				VALUES
				(
					@dondathang, @masp, @mahtr, @stt, @mact, @pcode, @chitiet, 
					@id_nguyenlieu, @nguyenlieu,
					@dayy_tc, @rong_tc, @dai_tc, @soluong_tc, @sokhoi_tinhche,
					@dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
					@soluong_dathang, @soluong_tc*@soluong_dathang, 0, 1,
					@nguoitao, @ngaytao, @nguoisua, @ngaysua,
					@ghichu, @veneer_matchinh, @veneer_matphu,
					@bemat, @somat_giacong, @donhang_sudung,
					@cc_canh1, @cc_canh2, @cc_dau1, @cc_dau2, @cc_mat1, @cc_mat2, @dayy_phoi,
					@veneer_canhdai, @veneer_canhngan, @veneer_dan_canh
				)
			END
			ELSE
			BEGIN
				UPDATE tr_pallet
				SET stt = @stt,
					tenct = @chitiet,
					id_nguyenlieu = @id_nguyenlieu,
					nguyenlieu = @nguyenlieu,
					dayy_tc = @dayy_tc,
					rong_tc = @rong_tc,
					dai_tc = @dai_tc,
					soluong_tc = @soluong_tc,
					sokhoi_tinhche = @m3_tc * @soluong_dathang,
					dayy_sc = @dayy_sc,
					rong_sc = @rong_sc,
					dai_sc = @dai_sc,
					soluong_sc = @soluong_sc,
					soluong_donhang = @soluong_dathang,
					soluong_can = @soluong_dathang * @soluong_tc,
					nguoisua = @nguoisua,
					ngaysua = @ngaysua,
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
					donhang = @donhang_sudung,
					veneer_canhdai = @veneer_canhdai, 
					veneer_canhngan = @veneer_canhngan, 
					veneer_dan_canh = @veneer_dan_canh,
					pcode = @pcode
				WHERE dondathang = @dondathang AND masp = @masp 
					AND mact = @mact --AND isCreateCard = 0
			END


			FETCH NEXT FROM CUR INTO @mact, @pcode, @stt, @chitiet, @id_nguyenlieu, @nguyenlieu, 
									 @dayy_tc, @rong_tc, @dai_tc, @soluong_tc, @m3_tc,
									 @dayy_sc, @rong_sc, @dai_sc, @soluong_sc,
									 @ghichu, @veneer_matchinh, @veneer_matphu,
									 @bemat, @somat_giacong,
									 @cc_canh1, @cc_canh2, @cc_dau1, @cc_dau2, @cc_mat1, @cc_mat2,
									 @dayy_phoi, @veneer_canhdai, @veneer_canhngan, @veneer_dan_canh
		END
		CLOSE CUR
		DEALLOCATE CUR
	END
END TRY
BEGIN CATCH

END CATCH

SELECT * 
FROM tr_pallet A
WHERE A.dondathang = @dondathang AND A.masp = @masp AND A.mact <> '000'
END
