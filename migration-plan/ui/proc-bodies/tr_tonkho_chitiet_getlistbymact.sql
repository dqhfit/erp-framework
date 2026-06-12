-- PARAMS:
-- @mavt nvarchar


CREATE PROC [dbo].[TR_TONKHO_CHITIET_GETLISTBYMACT]
(
    @mavt NVARCHAR(200)
)
AS
SELECT * 
FROM tr_tonkho_chitiet
WHERE mavt = @mavt 
ORDER BY keso, soluong


