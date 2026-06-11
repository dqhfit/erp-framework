-- PARAMS:
-- @donhang nvarchar
-- @dongianguyenlieu decimal OUTPUT

CREATE   PROCEDURE [dbo].[TR_TINHGIA_NGUYENLIEU]
(
    @donhang nvarchar(50),
    @dongianguyenlieu decimal(18, 5) OUT
)
AS
BEGIN
DECLARE @sokhoi float = 0, @thanhtien_vnd float = 0;
SELECT @sokhoi = SUM(B.sokhoi),
    @thanhtien_vnd = SUM(B.thanhtien * A.tigia)
FROM bg_donhang A
    INNER JOIN bg_donhang_chitiet B ON A.sophieu = B.sophieu
    INNER JOIN tr_dexuat_phoi C ON A.id_dexuat = C.id
    INNER JOIN tr_dexuat_phoi_chitiet D ON C.id = D.dexuat_id
WHERE CHARINDEX(@donhang, C.donhang) > 0

SET @dongianguyenlieu = IIF(@sokhoi <= 0, 0, @thanhtien_vnd / @sokhoi);
END
