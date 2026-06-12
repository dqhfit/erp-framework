-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_GETLISTBYDATE](@tungay date, @denngay date)
AS
SELECT A.*, B.masp_khachhang, B.masp_nhamay,c.tenbophan
FROM tr_baocao_hangloi A
    INNER JOIN tr_sanpham B ON (select dbo.ufn_MaHTR_To_MaSP( A.masp)) = B.masp
	left join tr_bophan c on a.bophantra = c.mabophan
WHERE A.ngaythang BETWEEN @tungay AND @denngay



