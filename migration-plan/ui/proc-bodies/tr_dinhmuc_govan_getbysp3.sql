-- PARAMS:
-- @masp nvarchar
-- @soluong int

CREATE PROC TR_DINHMUC_GOVAN_GETBYSP3
(
	@masp nvarchar(200),
	@soluong int = 1
)
AS
BEGIN
	SELECT A.id, A.masp, A.mact, A.stt, A.chitiet, A.nguyenlieu,
		A.dayy_tc, A.rong_tc, A.dai_tc, 
		A.soluong_tc * @soluong AS soluong_tc, 
		A.m3_tc * @soluong AS m3_tc,
		A.ghichu
	FROM tr_dinhmuc_govan A
	WHERE A.masp = @masp
END

