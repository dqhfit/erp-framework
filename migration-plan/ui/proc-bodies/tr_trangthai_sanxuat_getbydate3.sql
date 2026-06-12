-- PARAMS:
-- @tungay date
-- @denngay date


CREATE   PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDATE3]
(
	@tungay date,
	@denngay date
)
AS
SELECT A.madonhang, A.nguyenlieu, 
	A.ngaythang,
	met = SUM(A.dai * A.soluong)/1000,
	metvuong = SUM(A.rong * A.dai * A.soluong)/1000000,
	sokhoi = SUM(A.dayy * A.rong * A.dai * A.soluong)/1000000000,
	C.n_op AS tencongdoan,
	B.c_op, B.location_type, C.department, D.stt, C.stt as stt1
FROM tr_trangthai_sanxuat A
	INNER JOIN trtb_m_location_process B ON B.c_location = A.congdoan
	INNER JOIN trtb_m_op C ON B.c_op = C.c_op
	INNER JOIN tr_khuvuc_sanxuat D ON C.department = D.makhuvuc
WHERE A.ngaythang BETWEEN @tungay AND @denngay
	AND B.location_type = 'PROD'
GROUP BY A.madonhang, A.nguyenlieu, A.ngaythang, C.n_op, B.c_op, B.location_type, C.department, D.stt, C.stt
ORDER BY D.stt, C.stt

