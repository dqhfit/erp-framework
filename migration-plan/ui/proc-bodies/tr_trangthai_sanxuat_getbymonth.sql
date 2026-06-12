-- PARAMS:
-- @year int
-- @month int


CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYMONTH]
(
    @year int,
    @month int
)
AS
SELECT a.ngaythang, A.madonhang, A.nguyenlieu
    , soluong = SUM(A.soluong)
    , sokhoi = SUM(A.sokhoi)
    , NHA9 = SUM(CASE WHEN A.congdoan = 'NHA9' THEN ISNULL(A.sokhoi, 0) END)
    , NHAP = SUM(CASE WHEN A.congdoan = 'NHAP' THEN ISNULL(A.sokhoi, 0) END)
    , NHAO = SUM(CASE WHEN A.congdoan = 'NHAO' THEN ISNULL(A.sokhoi, 0) END)
    , VAN9 = SUM(CASE WHEN A.congdoan = 'VAN9' THEN ISNULL(A.sokhoi, 0) END)
    , VANP = SUM(CASE WHEN A.congdoan = 'VANP' THEN ISNULL(A.sokhoi, 0) END)
    , VANO = SUM(CASE WHEN A.congdoan = 'VANO' THEN ISNULL(A.sokhoi, 0) END)
    , DHI9 = SUM(CASE WHEN A.congdoan = 'DHI9' THEN ISNULL(A.sokhoi, 0) END)
    , DHIP = SUM(CASE WHEN A.congdoan = 'DHIP' THEN ISNULL(A.sokhoi, 0) END)
    , DHIO = SUM(CASE WHEN A.congdoan = 'DHIO' THEN ISNULL(A.sokhoi, 0) END)
    , LRA9 = SUM(CASE WHEN A.congdoan = 'LRA9' THEN ISNULL(A.sokhoi, 0) END)
    , LRAP = SUM(CASE WHEN A.congdoan = 'LRAP' THEN ISNULL(A.sokhoi, 0) END)
    , LRAO = SUM(CASE WHEN A.congdoan = 'LRAO' THEN ISNULL(A.sokhoi, 0) END)
FROM tr_trangthai_sanxuat a
WHERE YEAR(A.ngaythang) = @year
    AND MONTH(A.ngaythang) = @month
	AND congdoan NOT IN ('UVP')
GROUP BY a.ngaythang, A.madonhang, A.nguyenlieu


