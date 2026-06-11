-- PARAMS:
-- @LenhCapPhatID nvarchar


CREATE PROC [dbo].[TR_LENHCAPPHAT_SUMBYMACT](@LenhCapPhatID NVARCHAR(200))
AS
--DECLARE @LenhCapPhatID nvarchar(max)= 'LCP07012001';
SELECT a.LenhCapPhatID
	, a.LoaiDonHang
	, a.LoaiCapPhat
	, CASE WHEN a.MaDonDatHang = '' OR a.MaDonDatHang IS NULL THEN A.MaDonHang ELSE a.MaDonDatHang END AS MaDonHang
	, a.mavt
	, b.mota
	, b.quycach
	, b.mausac
	, SUM(A.soluong) AS soluong
	, b.dvt
	, a.ghichu
	, b.nhom
--INTO #LENHCAPPHAT
FROM   tr_lenhcapphat AS a WITH(NOLOCK), 
	  tr_material AS b WITH(NOLOCK)
WHERE  A.mavt = B.mavt
	  AND ISNULL(B.xoa, 'N') = 'N'
	  AND LenhCapPhatID = @LenhCapPhatID
	  AND ACTIVE = 1
GROUP BY a.LenhCapPhatID, a.LoaiDonHang, a.LoaiCapPhat
    , CASE WHEN a.MaDonDatHang = '' OR a.MaDonDatHang IS NULL THEN A.MaDonHang ELSE a.MaDonDatHang END
    , a.mavt, b.mota, b.quycach, b.mausac
    , b.dvt, a.ghichu, b.nhom
HAVING SUM(A.soluong) > 0
ORDER BY a.mavt

