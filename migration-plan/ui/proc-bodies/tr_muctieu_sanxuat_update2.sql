-- PARAMS:
-- @id uniqueidentifier
-- @ngaythang date
-- @macongdoan nvarchar
-- @donhang nvarchar
-- @hehang nvarchar
-- @muctieu float
-- @songuoi int
-- @sogio float
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar
-- @RowVer timestamp


CREATE   PROCEDURE [dbo].[TR_MUCTIEU_SANXUAT_UPDATE2]
(
	@id uniqueidentifier,	@ngaythang date,	@macongdoan nvarchar(50),	@donhang nvarchar(50),	@hehang nvarchar(50),	@muctieu float,	@songuoi int = 0,	@sogio float = 8,	@ngaytao datetime,	@nguoitao nvarchar(50),	@ngaysua datetime,	@nguoisua nvarchar(50),
	@RowVer timestamp
)
AS
BEGIN
DECLARE @heso decimal(18, 5)
--SET @heso = IIF(@muctieu = 0, 0, (@songuoi * @sogio) / @muctieu);
SET @heso = CASE WHEN @songuoi = 0 OR @sogio = 0 THEN 0 ELSE @muctieu / @songuoi / @sogio END;

UPDATE tr_muctieu_sanxuat
SET	macongdoan = @macongdoan,	donhang = @donhang,	hehang = @hehang,	muctieu = @muctieu, 	songuoi = @songuoi, 	sogio = @sogio, 	heso = @heso,	ngaysua = @ngaysua,	nguoisua = @nguoisua
WHERE id = @id AND RowVer = @RowVer
END

