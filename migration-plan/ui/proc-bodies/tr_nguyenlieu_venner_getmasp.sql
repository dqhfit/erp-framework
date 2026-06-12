-- PARAMS:
-- @masp nvarchar

CREATE PROC [dbo].[TR_NGUYENLIEU_VENNER_GETMASP]
(
	@masp nvarchar(300)
)
as
BEGIN
	SELECT * FROM tr_sanpham_venner a
	WHERE a.masp = @masp
END
