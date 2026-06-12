-- PARAMS:
-- @MaSP nvarchar
-- @baoGiaID uniqueidentifier

CREATE PROC [dbo].[TR_BAOGIA_DONGGOI_GET2]
(
	@MaSP nvarchar(200),
	@baoGiaID UNIQUEIDENTIFIER = NULL
)
AS
IF @baoGiaID IS NULL
BEGIN
	SELECT A.masp, A.mact, B.mota
		, B.quycach, b.dvt
		, A.soluong, A.dongia
		, (A.soluong * A.dongia) AS thanhtien
	FROM tr_baogia_donggoi A
		LEFT JOIN tr_material B
		ON A.mact = B.idxuong
	WHERE A.masp = @MaSP AND baoGiaID IS NULL
END
ELSE
BEGIN
	SELECT A.masp, A.mact, B.mota
		, B.quycach, b.dvt
		, A.soluong, A.dongia
		, (A.soluong * A.dongia) AS thanhtien
	FROM tr_baogia_donggoi A
		LEFT JOIN tr_material B
		ON A.mact = B.idxuong
	WHERE A.masp = @MaSP AND baoGiaID = @baoGiaID
END
