-- PARAMS:
-- @masp nvarchar

CREATE PROC [dbo].[TR_DINHMUC_GOVAN_GETBYSP2]
(
	@masp nvarchar(200)
)
AS
BEGIN
	SELECT A.id, A.masp, 
		A.mact, A.stt,
		dbo.GetNameBySTT(a.masp, LEFT(A.stt,1)) AS cumchitiet,
		A.chitiet, A.nguyenlieu, 
		A.dayy_tc, A.rong_tc, A.dai_tc, A.soluong_tc, A.m3_tc,
		A.dayy_sc, A.rong_sc, A.dai_sc, A.soluong_sc, 
		m3_sc = (A.dayy_sc * A.rong_sc * A.dai_sc * A.soluong_sc)/1000000000,
	
		non_fsc = IIF(A.fsc_id = 1, CONVERT(bit, 1), CONVERT(bit, 0)), 
		fsc_100 = IIF(A.fsc_id = 2, CONVERT(bit, 1), CONVERT(bit, 0)), 
		fsc_cw = IIF(A.fsc_id = 3, CONVERT(bit, 1), CONVERT(bit, 0)), 
		fsc_mix = IIF(A.fsc_id = 3, CONVERT(bit, 1), CONVERT(bit, 0)), 
		fsc_recycled = IIF(A.fsc_id = 4, CONVERT(bit, 1), CONVERT(bit, 0)),
		A.fsc_id,
		A.mong1, A.mong2,
		C.loaihang AS tenveneer_matchinh,
		D.loaihang AS tenveneer_matphu,
		VNC.loaihang AS tenveneer_dancanh,
		A.veneer_canhdai, a.veneer_canhngan,
		UVMC.loai_uv AS tenuv_matchinh1,
		UVMP.loai_uv AS tenuv_matphu1,
		UVCN.loai_uv AS tenuv_canhngan1,
		UVCD.loai_uv AS tenuv_canhdai1,
		B.ma_btp, B.ma_erp, B.masp AS masp1,
		A.ghichu,
		ghichu1 = A.ghichu
	FROM tr_dinhmuc_govan A
		INNER JOIN tr_sanpham B ON A.masp = B.masp
		LEFT JOIN tr_baogia_chiphi_veneer C ON A.veneer_matchinh = C.id
		LEFT JOIN tr_baogia_chiphi_veneer D ON A.veneer_matphu = D.id
		LEFT JOIN tr_baogia_chiphi_veneer VNC ON A.veneer_dan_canh = VNC.id
		LEFT JOIN tr_loai_uv UVMC ON A.uv_matchinh1 = UVMC.id
		LEFT JOIN tr_loai_uv UVMP ON A.uv_matphu1 = UVMP.id
		LEFT JOIN tr_loai_uv UVCN ON A.uv_canhngan1 = UVCN.id
		LEFT JOIN tr_loai_uv UVCD ON A.uv_canhdai1 = UVCD.id
	WHERE a.masp = @masp AND ISNULL(a.mact, '') <> '000'
	ORDER BY LEFT(A.stt, 1), REPLACE(A.stt, LEFT(A.stt, 1), '')
END

