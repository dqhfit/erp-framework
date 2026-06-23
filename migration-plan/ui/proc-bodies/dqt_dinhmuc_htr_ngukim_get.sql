-- PARAMS:
-- @mahtr nvarchar
-- @soluong int

CREATE PROCEDURE DQT_DINHMUC_HTR_NGUKIM_GET (@mahtr     NVARCHAR (200), @soluong   INT= 1)
AS
SELECT a.mact,
       b.mota,
       b.quycach,
       b.mausac,
       b.dvt,
       soluong = (a.soluong * @soluong)
FROM tr_bom_htr a, tr_material b
WHERE a.mact = b.mavt AND b.xoa = 'N' AND a.mahtr = @mahtr
ORDER BY a.mact
