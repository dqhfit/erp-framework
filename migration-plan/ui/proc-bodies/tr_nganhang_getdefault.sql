-- PARAMS:
-- (khong co tham so)



CREATE PROC [dbo].[TR_NGANHANG_GETDEFAULT]
AS
SELECT TOP 1 * 
FROM tr_nganhang
WHERE IsDefault = 1

