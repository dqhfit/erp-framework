-- PARAMS:
-- @id_baocao uniqueidentifier



CREATE PROC [dbo].[TR_BAOCAO_ROTCHUYEN_GETBYIDBAOCAO](@id_baocao uniqueidentifier)
AS
SELECT a.*, b.masp_khachhang, b.masp_nhamay
FROM tr_baocao_rotchuyen a
    INNER JOIN tr_sanpham b ON a.masp = b.masp
WHERE a.id_baocao = @id_baocao

