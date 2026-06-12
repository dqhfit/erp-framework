-- PARAMS:
-- @masp nvarchar

CREATE PROC [dbo].[TR_DINHMUC_SON2_GETLISTBYMASP](@masp NVARCHAR(200))
AS
SELECT * FROM tr_dinhmuc_son2
WHERE masp = @masp
ORDER BY stt
