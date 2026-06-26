-- PARAMS:
-- @fromProduct nvarchar
-- @toProduct nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar

CREATE PROC [dbo].[MES_DINHMUC_DONGGOI_COPY]
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

	DECLARE @fromColor nvarchar(200)
	DECLARE @toColor nvarchar(200)

	SELECT TOP 1 @fromColor = masp_mausac 
	FROM mes_dinhmuc_donggoi
	WHERE masp = @fromProduct
	ORDER BY ngaysua DESC

	DECLARE CUR CURSOR LOCAL FOR
		SELECT mausac FROM tr_sanpham
		WHERE masp_nhamay = @toProduct AND active = 1
		GROUP BY mausac
	OPEN CUR
	FETCH NEXT FROM CUR INTO @toColor
	WHILE @@FETCH_STATUS = 0
	BEGIN
		IF EXISTS (SELECT 1 FROM mes_dinhmuc_donggoi WHERE masp = @toProduct AND masp_mausac = @toColor)
		BEGIN
			DELETE mes_dinhmuc_donggoi 
			WHERE masp = @toProduct AND masp_mausac = @toColor
		END
		
		INSERT INTO mes_dinhmuc_donggoi
		(
			stt, masp, masp_mausac, mavt, chitiet,
			soluong, cbm, IsPacking, ghichu, hoanthanh,
			ngaytao, nguoitao, ngaysua, nguoisua, id_dinhmuc
		)
		SELECT stt, @toProduct, @toColor, mavt, chitiet, 
			soluong, cbm, IsPacking, ghichu, hoanthanh, 
			@ngaytao, @nguoitao, @ngaysua, @nguoisua, id_dinhmuc
		FROM mes_dinhmuc_donggoi
		WHERE masp = @fromProduct AND masp_mausac = @fromColor

		FETCH NEXT FROM CUR INTO @toColor
	END
	CLOSE CUR
	DEALLOCATE CUR

	COMMIT TRANSACTION
END TRY
BEGIN CATCH
	ROLLBACK TRANSACTION
END CATCH
