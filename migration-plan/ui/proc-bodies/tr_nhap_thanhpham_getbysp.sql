-- PARAMS:
-- @masp nvarchar
-- @ngaythang date
-- @tongsoluong int OUTPUT


CREATE PROC TR_NHAP_THANHPHAM_GETBYSP
(
	@masp nvarchar(200),
	@ngaythang date,
	@tongsoluong int OUT
)
AS
BEGIN
	SELECT @tongsoluong = SUM(A.soluong) FROM tr_nhap_thanhpham A
	WHERE A.masp = @masp 
		AND CAST(A.ngaytao AS date) = @ngaythang

	--SELECT * FROM tr_nhap_thanhpham A
	--WHERE A.masp = @masp 
	--	AND CAST(A.ngaytao AS date) = @ngaythang
END


