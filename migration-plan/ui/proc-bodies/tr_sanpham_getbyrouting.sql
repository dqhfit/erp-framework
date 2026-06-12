-- PARAMS:
-- (khong co tham so)


CREATE PROC TR_SANPHAM_GETBYROUTING
AS
BEGIN
	SELECT A.masp, A.tensp, A.tensp_vn, A.hehang, A.customer
	FROM tr_sanpham A
		INNER JOIN tr_quytrinh_sanpham2 B ON A.masp = B.masp
	GROUP BY A.masp, A.tensp, A.tensp_vn, A.hehang, A.customer
END

