-- PARAMS:
-- @masp nvarchar


CREATE PROC [dbo].[TR_NGUYENLIEU_TEM_GETMASP]
(
	@masp nvarchar(300)
)
as
BEGIN
	SELECT * FROM tr_sanpham_tem a
	WHERE a.masp = @masp
END

