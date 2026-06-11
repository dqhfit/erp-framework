-- PARAMS:
-- @id_baocao uniqueidentifier
-- @macongdoan nvarchar


CREATE PROCEDURE [dbo].[TR_BAOCAO_CHUYENSON_CHITIET_DELETE2] (@id_baocao uniqueidentifier, @macongdoan nvarchar(50))
AS
BEGIN
	DELETE tr_baocao_chuyenson_chitiet 
	WHERE id_baocao = @id_baocao AND macongdoan = @macongdoan
END

