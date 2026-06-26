-- PARAMS:
-- @fromProduct nvarchar
-- @toProduct nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar

CREATE PROC [dbo].[MES_DINHMUC_GOVAN_COPY]
(
	@fromProduct nvarchar(200),
	@toProduct nvarchar(200),
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50)
)
AS
BEGIN TRY
	BEGIN TRANSACTION

	-- XÓA CÁC DỮ LIỆU CỦA MÃ MỚI
	DELETE mes_dinhmuc_govan_ghichu WHERE masp_nhamay = @toProduct;
	DELETE mes_dinhmuc_govan WHERE masp = @toProduct;
	DELETE mes_quytrinh_sanpham WHERE masp = @toProduct;

	-- COPY ĐỊNH MỨC GỖ VÁN
	INSERT INTO mes_dinhmuc_govan
	(
		masp, mact, stt, chitiet, nguyenlieu, id_nguyenlieu,
		dayy_tc, rong_tc, dai_tc, soluong_tc, m3_tc, m2_tc,
		dayy_sc, rong_sc, dai_sc, soluong_sc, m3_sc,
		ghichu, hoanthanh, mong1, mong2,
		veneer_matchinh, veneer_matphu, veneer_dan_canh,
		uv_matchinh, uv_matphu, uv_canhdai, uv_canhngan,
		uv_matchinh1, uv_matphu1, uv_canhdai1, uv_canhngan1,
		veneer_canhdai, veneer_canhngan,
		ngaytao, nguoitao, ngaysua, nguoisua,
		banve
	)
	SELECT @toProduct as masp, mact, stt, chitiet, nguyenlieu, id_nguyenlieu,
		   dayy_tc, rong_tc, dai_tc, soluong_tc, m3_tc, m2_tc,
		   dayy_sc, rong_sc, dai_sc, soluong_sc, m3_sc,
		   ghichu, hoanthanh, mong1, mong2,
		   veneer_matchinh, veneer_matphu, veneer_dan_canh,
		   uv_matchinh1, uv_matphu1, uv_canhdai1, uv_canhngan1,
		   uv_matchinh, uv_matphu, uv_canhdai, uv_canhngan,
		   veneer_canhdai, veneer_canhngan,
		   @ngaytao, @nguoitao, @ngaysua, @nguoisua,
		   banve
	FROM mes_dinhmuc_govan
	WHERE masp = @fromProduct

	-- COPY GHI CHÚ
	DECLARE @mausac nvarchar(200) = '';
	SELECT @mausac = masp_mausac
	FROM mes_dinhmuc_govan_ghichu 
	WHERE masp_nhamay = @fromProduct
	ORDER BY LEN(ghichu) DESC

	DECLARE @mact nvarchar(50) = '';
	DECLARE @ghichu nvarchar(max) = '';
	DECLARE CUR CURSOR LOCAL FOR
		SELECT mact, ghichu FROM mes_dinhmuc_govan_ghichu
		WHERE masp_nhamay = @fromProduct AND masp_mausac = @mausac
	OPEN CUR
	FETCH NEXT FROM CUR INTO @mact, @ghichu
	WHILE @@FETCH_STATUS = 0
	BEGIN
		DECLARE CUR_GHICHU CURSOR LOCAL FOR
		SELECT DISTINCT mausac FROM tr_sanpham 
		WHERE masp_nhamay = @toProduct 
		ORDER BY mausac
		OPEN CUR_GHICHU
		FETCH NEXT FROM CUR_GHICHU INTO @mausac
		WHILE @@FETCH_STATUS = 0
		BEGIN
			INSERT INTO mes_dinhmuc_govan_ghichu(id, masp_nhamay, masp_mausac, mact, ghichu)
			VALUES (NEWID(), @toProduct, @mausac, @mact, @ghichu)
			FETCH NEXT FROM CUR_GHICHU INTO @mausac
		END
		CLOSE CUR_GHICHU;
		DEALLOCATE CUR_GHICHU;

		FETCH NEXT FROM CUR INTO @mact, @ghichu
	END
	CLOSE CUR;
	DEALLOCATE CUR;

	COMMIT TRANSACTION
END TRY
BEGIN CATCH
	ROLLBACK TRANSACTION
END CATCH
