-- PARAMS:
-- @listPO nvarchar


CREATE PROC TR_THONGKE_SOKHOI_DDH
(
	@listPO nvarchar(max)
)
AS
BEGIN
	SELECT B.nguyenlieu, B.dayy_tc,
		m3_tc = SUM(B.dayy_tc * B.rong_tc * B.dai_tc * B.soluong_tc * A.soluong)/1000000000
	FROM tr_dondathang_chitiet A
		INNER JOIN tr_dinhmuc_govan B ON ISNULL(A.masp, dbo.ufn_MaHTR_To_MaSP(A.chitiet)) = B.masp
	WHERE A.maddh IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@listPO,','))
		AND B.nguyenlieu NOT IN ('', '0')
	GROUP BY B.nguyenlieu, B.dayy_tc
END

