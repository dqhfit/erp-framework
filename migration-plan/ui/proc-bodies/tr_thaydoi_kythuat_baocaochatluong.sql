-- PARAMS:
-- @TUNGAY date
-- @DENNGAY date


CREATE   PROCEDURE TR_THAYDOI_KYTHUAT_BAOCAOCHATLUONG
(
	@TUNGAY DATE,
	@DENNGAY DATE
)
AS
BEGIN
	SELECT DATEPART(WEEK, A.ngaytao) AS sotuan,
		A.hehang, A.masp, COALESCE(B.tensp, A.tensp) AS tensp, A.noidungcanthaydoi, A.lydothaydoi
	FROM tr_thaydoi_kythuat A
		LEFT JOIN tr_sanpham B ON A.masp = B.masp
	WHERE CAST(A.ngaytao AS DATE) BETWEEN @TUNGAY AND @DENNGAY
		AND A.active = 1
	ORDER BY sotuan, hehang, tensp
END

