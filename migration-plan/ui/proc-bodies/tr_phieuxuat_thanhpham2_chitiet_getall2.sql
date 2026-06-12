-- PARAMS:
-- @phieuxuat_id int


CREATE   PROCEDURE TR_PHIEUXUAT_THANHPHAM2_CHITIET_GETALL2(@phieuxuat_id int)
AS
BEGIN
	SELECT B.*, D.tensp, C.fsc_id, FSC.fsc_name, D.nguyenlieu 
	FROM tr_phieuxuat_thanhpham2 A
		INNER JOIN tr_phieuxuat_thanhpham2_chitiet B ON A.phieuxuat_id = B.phieuxuat_id
		INNER JOIN tr_order C ON A.madonhang = C.order_number
		INNER JOIN tr_sanpham D ON B.masp = D.masp
		LEFT JOIN tr_tinhtrang_fsc FSC ON C.fsc_id = FSC.fsc_id
	WHERE A.phieuxuat_id = @phieuxuat_id
END

