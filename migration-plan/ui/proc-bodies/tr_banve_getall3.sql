-- PARAMS:
-- @active bit


CREATE PROC TR_BANVE_GETALL3(@active bit)
AS
SELECT A.id, A.masp, 
	B.tensp, 
	B.customer AS khachhang, 
	B.hehang,
	A.filepath, A.seq1, A.seq2, A.phanloai,
	A.create_by, A.create_date, A.update_by, A.update_date, A.active
FROM tr_banve A
	INNER JOIN tr_sanpham B ON A.masp = B.masp
WHERE A.active = @active


