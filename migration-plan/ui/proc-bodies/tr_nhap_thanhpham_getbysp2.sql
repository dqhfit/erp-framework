-- PARAMS:
-- @madonhang nvarchar
-- @masp nvarchar
-- @tongsoluong int OUTPUT


CREATE PROC [dbo].[TR_NHAP_THANHPHAM_GETBYSP2]
(
	@madonhang nvarchar(200),
	@masp nvarchar(200),
	@tongsoluong int OUT
)
AS
BEGIN
	SELECT @tongsoluong = SUM(A.soluong) 
	FROM tr_nhap_thanhpham A
	WHERE A.masp = @masp AND madonhang = @madonhang
END




