-- PARAMS:
-- @MaSP nvarchar
-- @baoGiaID uniqueidentifier

CREATE PROC [dbo].[TR_BAOGIA_NGUKIM_GET2]
(
	@MaSP NVARCHAR(200),
	@baoGiaID UNIQUEIDENTIFIER = NULL
)
AS
IF @baoGiaID IS NULL
BEGIN
	SELECT A.masp, A.mact, B.mota
		, B.quycach, B.dvt
		, A.soluong, A.dongia
		, (A.soluong * A.dongia) AS thanhtien
	FROM tr_baogia_ngukim A
		LEFT JOIN tr_material B
		ON A.mact = B.idxuong
	WHERE A.masp = @MaSP AND A.baoGiaID IS NULL
END
ELSE
BEGIN
	SELECT A.masp, A.mact, B.mota
		, B.quycach, B.dvt
		, A.soluong, A.dongia
		, (A.soluong * A.dongia) AS thanhtien
	FROM tr_baogia_ngukim A
		LEFT JOIN tr_material B
		ON A.mact = B.idxuong
	WHERE A.masp = @MaSP AND A.baoGiaID  = @baoGiaID
END
