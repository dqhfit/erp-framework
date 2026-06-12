-- PARAMS:
-- @masp nvarchar


CREATE PROC [dbo].[TR_NGUYENLIEU_NGUKIM_GETMASP]
(
	@masp nvarchar(300)
)
as
BEGIN
	SELECT * FROM tr_sanpham_ngukim a
	WHERE a.masp = @masp
END

