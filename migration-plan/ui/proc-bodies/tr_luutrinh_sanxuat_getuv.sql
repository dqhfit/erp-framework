-- PARAMS:
-- @MaSP nvarchar
-- @MaCT nvarchar
-- @id_rout int


CREATE PROC [dbo].[TR_LUUTRINH_SANXUAT_GETUV]
(
    @MaSP NVARCHAR(200),
    @MaCT NVARCHAR(50),
    @id_rout INT
)
AS
--select * from tr_luutrinh_sanxuat
--where MaSP = @MaSP
--    and MaCT = @MaCT
--    and id_rout = @id_rout

SELECT 
    p.value('(./ID)[1]', 'NVARCHAR(200)') AS ID,
    p.value('(./SoMat)[1]', 'INT') AS somat,
    p.value('(./SoCanh)[1]', 'INT') AS socanh,
    p.value('(./SoDau)[1]', 'INT') AS sodau,
    p.value('(./ThongTin)[1]', 'NVARCHAR(200)') AS ThongTin
FROM tr_luutrinh_sanxuat WITH(NOLOCK)
    CROSS APPLY LanUV.nodes('/TR_BANGMAU//BangMau') t(p)
WHERE MaSP = @MaSP
    AND MaCT = @MaCT
    AND id_rout = @id_rout


