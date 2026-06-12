-- PARAMS:
-- @SoPhieu nvarchar


CREATE PROC [dbo].[ListWHSInOut_Detail]
(
	@SoPhieu NVARCHAR(MAX)
)
AS
SELECT sophieu, mavt, mota, quycach, mausac, dvt, soluong, ghichu
FROM (
select a.sopn as sophieu, a.mavt, b.mota, b.quycach, b.mausac, b.dvt
	, a.slnhap as soluong
	, a.ghichu
from tr_ctphieunhap a WITH(NOLOCK), tr_material b WITH(NOLOCK)
WHERE a.mavt = ISNULL(b.idxuong, b.mavt) AND (A.slnhap + A.soluong_du) > 0
union all
select a.phieuxuat as sophieu, a.mact as mavt , b.mota, b.quycach, b.mausac, b.dvt
	, a.soluong, a.ghichu
from tr_ctphieuxuat a WITH(NOLOCK), tr_material b WITH(NOLOCK)
WHERE a.mact = ISNULL(b.idxuong, b.mavt) AND A.soluong > 0
) A
WHERE A.sophieu = @SoPhieu
order by mavt
