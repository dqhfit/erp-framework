-- PARAMS:
-- @id uniqueidentifier
-- @macongdoan nvarchar
-- @ngaythang date
-- @songuoi_hanhchanh int
-- @songuoi_tangca int
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar
-- @RowVer timestamp

CREATE   PROCEDURE [dbo].[TR_BAOCAO_HIENDIEN4_UPDATE2]
(
	@id uniqueidentifier,
	@macongdoan nvarchar(50),
	@ngaythang date,
	@songuoi_hanhchanh int,
	@songuoi_tangca int,
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50),
    @RowVer timestamp
)
AS
BEGIN

	UPDATE tr_baocao_hiendien4
	SET
		macongdoan = @macongdoan,
		ngaythang = @ngaythang,
		songuoi_hanhchanh = @songuoi_hanhchanh,
		songuoi_tangca = @songuoi_tangca,
		ngaysua = @ngaysua,
		nguoisua = @nguoisua
	WHERE id = @id AND RowVer = @RowVer

	IF EXISTS (SELECT 1 FROM tr_muctieu_sanxuat2_chitiet WHERE macongdoan = @macongdoan AND ngaythang = @ngaythang)
	BEGIN
		UPDATE tr_muctieu_sanxuat2_chitiet
		SET songuoi_hiendien_hc = @songuoi_hanhchanh,
			songuoi_hiendien_tc = @songuoi_tangca
		WHERE macongdoan = @macongdoan AND ngaythang = @ngaythang
	END
END
