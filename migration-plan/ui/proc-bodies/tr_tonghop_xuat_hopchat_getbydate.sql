-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROC TR_TONGHOP_XUAT_HOPCHAT_GETBYDATE(@tungay date, @denngay date)
AS
BEGIN
	SELECT * FROM tr_tonghop_xuat_hopchat
	WHERE ngaythang BETWEEN @tungay AND @denngay
END

