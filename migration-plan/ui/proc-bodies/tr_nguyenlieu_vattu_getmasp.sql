-- PARAMS:
-- @masp nvarchar


CREATE PROC [dbo].[TR_NGUYENLIEU_VATTU_GETMASP]
(
	@masp nvarchar(300)
)
as
BEGIN
	SELECT * FROM tr_sanpham_vattu a
	WHERE a.masp = @masp
END

