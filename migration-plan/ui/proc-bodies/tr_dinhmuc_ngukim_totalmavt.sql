-- PARAMS:
-- @MASP nvarchar
-- @SOLUONG int


CREATE PROC [dbo].[TR_DINHMUC_NGUKIM_TOTALMAVT]
(
    @MASP NVARCHAR(200),
    @SOLUONG INT = 1
)
AS
SELECT masp
    , mavt
    , HWforWW
    , HWforPacking
    , HWforAI
    , SUM(soluong) as soluong
    , SUM(soluong * @SOLUONG) soluong_tong
FROM tr_dinhmuc_ngukim a
WHERE a.masp = @MASP
    AND ISNULL(a.ccode, '') <> '000'
GROUP BY masp, mavt, HWforWW, HWforPacking, HWforAI



