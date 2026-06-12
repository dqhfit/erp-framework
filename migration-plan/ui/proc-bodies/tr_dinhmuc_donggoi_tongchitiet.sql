-- PARAMS:
-- @MASP nvarchar
-- @SOLUONG int


CREATE PROC [dbo].[TR_DINHMUC_DONGGOI_TONGCHITIET]
(
    @MASP NVARCHAR(200),
    @SOLUONG INT = 1
)
AS
SELECT masp, madonggoi
    , SUM(soluong) soluong
    , SUM(soluong * @SOLUONG) AS soluong_tong
FROM tr_dinhmuc_donggoi
WHERE ISNULL(ccode,'') <> '000'
    AND masp = @MASP
GROUP BY masp, madonggoi

