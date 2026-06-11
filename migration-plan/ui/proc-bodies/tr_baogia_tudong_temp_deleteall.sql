-- PARAMS:
-- @username nvarchar


CREATE PROC TR_BAOGIA_TUDONG_TEMP_DELETEALL(@username nvarchar(50))
AS
BEGIN
	DELETE tr_baogia_tudong_temp WHERE username = @username
END

