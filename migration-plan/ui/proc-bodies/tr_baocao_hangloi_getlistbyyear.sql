-- PARAMS:
-- @year int


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_GETLISTBYYEAR](@year int)
AS
SELECT A.*, B.masp_khachhang, B.masp_nhamay,c.tenbophan
FROM tr_baocao_hangloi A
    INNER JOIN tr_sanpham B ON (select dbo.ufn_MaHTR_To_MaSP( A.masp)) = B.masp
	left join tr_bophan c on a.bophantra = c.mabophan
WHERE YEAR(A.ngaythang) = @year


