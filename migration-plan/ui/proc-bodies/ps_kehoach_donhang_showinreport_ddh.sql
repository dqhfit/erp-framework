-- PARAMS:
-- @dondathang nvarchar
-- @hienthi bit


CREATE   PROC PS_KEHOACH_DONHANG_SHOWINREPORT_DDH(@dondathang nvarchar(max), @hienthi bit)
AS
BEGIN
	DECLARE @hienthi1 bit;
	SELECT @hienthi1 = hienthi FROM ps_kehoach_donhang WHERE dondathang = @dondathang
	IF @hienthi1 = 1
		SET @hienthi = 0
	ELSE
		SET @hienthi = 1

	UPDATE ps_kehoach_donhang
	SET hienthi = @hienthi
	WHERE dondathang = @dondathang
END

