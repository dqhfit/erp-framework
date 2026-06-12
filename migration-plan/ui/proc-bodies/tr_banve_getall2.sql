-- PARAMS:
-- @status int

CREATE PROC [dbo].[TR_BANVE_GetAll2]
(
	@status INT = 1
)
AS
IF @status = 1
BEGIN
	SELECT b.*, a.tensp
	FROM tr_sanpham A
		RIGHT JOIN tr_banve B
		ON A.masp = B.masp
	WHERE B.active = 1
	ORDER BY B.masp
END

IF @status = 0
BEGIN
	SELECT b.id, a.masp, a.tensp
		, a.customer as khachhang
		, a.hehang, b.filepath
		, b.PDFFile, b.seq1, b.seq2
		, b.update_by, b.update_date
		, b.create_by, b.create_date
		, b.active
		, b.banve_donggoi, b.banve_govan
		, b.phanloai
	FROM tr_sanpham A
		LEFT JOIN tr_banve B
		ON A.masp = B.masp AND B.active = 1
	WHERE B.active IS NULL
	ORDER BY A.masp
END






