-- PARAMS:
-- @masp nvarchar


CREATE   PROC [dbo].[TR_QUYTRINH_SANPHAM2_GETALL3](@masp nvarchar(200))
AS
BEGIN
	SELECT B.masp, B.mact, B.stt, B.chitiet AS tenct, B.nguyenlieu, 
		B.dayy_tc, B.rong_tc, B.dai_tc,
		MAX(CASE WHEN buoc = 1 THEN A.n_op END) B1,
		MAX(CASE WHEN buoc = 2 THEN A.n_op END) B2,
		MAX(CASE WHEN buoc = 3 THEN A.n_op END) B3,
		MAX(CASE WHEN buoc = 4 THEN A.n_op END) B4,
		MAX(CASE WHEN buoc = 5 THEN A.n_op END) B5,
		MAX(CASE WHEN buoc = 6 THEN A.n_op END) B6,
		MAX(CASE WHEN buoc = 7 THEN A.n_op END) B7,
		MAX(CASE WHEN buoc = 8 THEN A.n_op END) B8,
		MAX(CASE WHEN buoc = 9 THEN A.n_op END) B9,
		MAX(CASE WHEN buoc = 10 THEN A.n_op END) B10,
		MAX(CASE WHEN buoc = 11 THEN A.n_op END) B11,
		MAX(CASE WHEN buoc = 12 THEN A.n_op END) B12,
		MAX(CASE WHEN buoc = 13 THEN A.n_op END) B13,
		MAX(CASE WHEN buoc = 14 THEN A.n_op END) B14,
		MAX(CASE WHEN buoc = 15 THEN A.n_op END) B15,
		MAX(CASE WHEN buoc = 16 THEN A.n_op END) B16,
		MAX(CASE WHEN buoc = 17 THEN A.n_op END) B17,
		MAX(CASE WHEN buoc = 18 THEN A.n_op END) B18,
		MAX(CASE WHEN buoc = 19 THEN A.n_op END) B19,
		MAX(CASE WHEN buoc = 20 THEN A.n_op END) B20
	FROM (
	SELECT A.masp, A.mact, A.buoc, A.quytrinh, A.maymoc, B.n_op, C.tenkhuvuc
	FROM tr_quytrinh_sanpham2 A
		LEFT JOIN trtb_m_op B ON A.quytrinh = B.c_op
		LEFT JOIN tr_khuvuc_sanxuat C ON B.department = C.makhuvuc
	WHERE A.masp = @masp AND A.active = 1) A
		RIGHT JOIN (SELECT * FROM tr_dinhmuc_govan WHERE masp = @masp) B ON A.masp = B.masp AND A.mact = B.mact
	GROUP BY B.masp, B.mact, B.stt, B.chitiet, B.nguyenlieu, B.dayy_tc, B.rong_tc, B.dai_tc
	ORDER BY B.stt
END
