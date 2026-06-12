-- PARAMS:
-- @MaSP nvarchar
-- @baoGiaID uniqueidentifier

CREATE PROC [dbo].[TR_BAOGIA_THANHPHAM_GET2]
(
	@MaSP nvarchar(200),
	@baoGiaID UNIQUEIDENTIFIER = NULL
)
AS
IF @baoGiaID IS NULL
BEGIN
	SELECT*
	FROM tr_baogia_thanhpham A
	WHERE A.masp = @MaSP AND baoGiaID IS NULL
END
ELSE
BEGIN
	SELECT*
	FROM tr_baogia_thanhpham A
	WHERE A.masp = @MaSP AND baoGiaID = @baoGiaID
END
