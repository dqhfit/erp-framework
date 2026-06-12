-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROCEDURE [dbo].[SAL_BAOGIA_GOVAN_GETBYDATE](@tungay date, @denngay date)
AS
BEGIN
	SELECT A.*, B.FullName AS tennguoitao, C.FullName AS tennguoisua
	FROM sal_baogia_govan A
		LEFT JOIN SYS_USER B ON A.nguoitao = B.UserName
		LEFT JOIN SYS_USER C ON A.nguoisua = C.UserName
	WHERE A.active = 1 AND A.ngaybaogia BETWEEN @tungay AND @denngay
END

