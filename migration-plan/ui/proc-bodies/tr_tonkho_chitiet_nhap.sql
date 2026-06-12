-- PARAMS:
-- @makho nvarchar
-- @mavt nvarchar
-- @keso nvarchar
-- @soluong decimal

CREATE PROC [dbo].[TR_TONKHO_CHITIET_NHAP]
(
	@makho NVARCHAR(10), 
	@mavt NVARCHAR(200), 
	@keso NVARCHAR(50), 
	@soluong DECIMAL(18, 3)
)
AS

IF NOT EXISTS (SELECT * FROM tr_tonkho_chitiet WHERE makho = @makho AND mavt = @mavt AND keso = @keso)
BEGIN
    INSERT INTO tr_tonkho_chitiet
    (
	   makho,
	   mavt,
	   keso,
	   soluong,
	   ngaytao,
	   update_date
    )
    VALUES
    (
	   @makho,
	   @mavt,
	   @keso,
	   @soluong,
	   GETDATE(),
	   GETDATE()
    )
END
ELSE
BEGIN
    UPDATE tr_tonkho_chitiet
    SET soluong = soluong + @soluong,
	   update_date = GETDATE()
    WHERE mavt = @mavt AND keso = @keso
END
