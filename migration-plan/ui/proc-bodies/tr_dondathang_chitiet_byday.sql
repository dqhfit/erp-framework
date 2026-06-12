-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROC [dbo].[TR_DONDATHANG_CHITIET_BYDAY]
(
	@tungay date,
	@denngay date
)
AS
BEGIN
	SELECT a.loaiddh, A.maddh, A.mancc, A.tenncc, A.donhang, 
		A.ngaydat,
		YEAR(A.ngaydat) as nam, MONTH(A.ngaydat) as thang, 
		B.chitiet, C.mota, C.quycach, C.mausac, C.dvt, C.nhom,
		SUM(B.soluong) AS soluong, 
		SUM(B.sl_danhan) AS sl_danhan, 
		SUM(B.sl_conlai) AS sl_conlai, 
		B.dongia
	FROM tr_dondathang A
		INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
		INNER JOIN tr_material C ON B.chitiet = C.mavt
	WHERE A.active = 1 AND A.pheduyet = 1
		AND CAST(A.create_date AS DATE) BETWEEN @tungay AND @denngay
	GROUP BY a.loaiddh, A.maddh, A.mancc, A.tenncc, A.donhang, A.ngaydat, YEAR(A.ngaydat), MONTH(A.ngaydat), 
		B.chitiet, C.mota, C.quycach, C.mausac, C.dvt, C.nhom, B.dongia
END
