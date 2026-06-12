-- PARAMS:
-- @madonhang nvarchar


CREATE PROC TR_PHIEUGIAO_THANHPHAM_CHITIET_GETBYORDER(@madonhang NVARCHAR(200))
AS
BEGIN
	SELECT * FROM tr_phieugiao_thanhpham_chitiet A
	WHERE A.madonhang = @madonhang
END

