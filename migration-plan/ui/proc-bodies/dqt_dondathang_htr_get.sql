-- PARAMS:
-- @maddh nvarchar
-- @chitiet nvarchar


CREATE PROC [dbo].[DQT_DONDATHANG_HTR_GET]
(
    @maddh NVARCHAR(200),
    @chitiet NVARCHAR(100) = ''
)
AS
SELECT A.maddh, A.mancc, A.tenncc, A.ngaydat, b.masp, b.chitiet, b.tenchitiet
    , SUM(b.soluong) soluong
FROM tr_dondathang A
    INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
WHERE A.active = 1 AND A.pheduyet = 1
    AND A.trangthai NOT IN ('-1', '3')
    AND A.mancc IN ('DQH', 'DQT')
    AND B.chitiet LIKE CASE WHEN @chitiet = '' THEN 'W%' ELSE @chitiet END
    and a.maddh = @maddh
GROUP BY A.maddh, A.mancc, A.tenncc, A.ngaydat, b.masp, b.chitiet, b.tenchitiet
