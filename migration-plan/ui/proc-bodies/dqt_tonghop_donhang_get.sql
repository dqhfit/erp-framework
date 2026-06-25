-- PARAMS:
-- @maddh nvarchar

CREATE PROC [dbo].[DQT_TONGHOP_DONHANG_GET](@maddh NVARCHAR(max))
AS
BEGIN
	SELECT 
		  --F.tensp	
		  B.chitiet
		, B.nguyenlieu
		, CASE WHEN B.chitiet_ghep2 = 1 THEN N'CHI TIẾT GHÉP' ELSE N'CHI TIẾT ĂN NGAY' END chitiet_ghep2
		, B.dayy_tc, B.rong_tc, B.dai_tc
		, B.dayy_sc
		, rong_sc = B.rong_tc + 1
		, dai_sc = ISNULL(NL.congdaiphoi, 0) + B.dai_tc
		, B.soluong_tc
		, SUM(A.soluong * B.soluong_tc) AS soluong
		, m3_tc = SUM((B.dayy_tc * B.rong_tc * B.dai_tc * A.soluong * B.soluong_tc)/1000000000)
		, B.veneer_canhngan, B.veneer_canhdai
		, B.veneer_matchinh
		, B.veneer_matphu
		, B.veneer_dan_canh
		, C.loaihang AS MC
		, D.loaihang AS MP
		, E.loaihang AS DC
		, NL.tilehaohut
		, NL.congdaiphoi
	INTO #TONGHOP_CHITIET
	FROM tr_dondathang_chitiet A
		INNER JOIN tr_dinhmuc_govan B ON A.masp = B.masp
		LEFT JOIN tr_baogia_chiphi_veneer C on B.veneer_matchinh = C.id
		LEFT JOIN tr_baogia_chiphi_veneer D on B.veneer_matphu = D.id
		LEFT JOIN tr_baogia_chiphi_veneer E on B.veneer_dan_canh = E.id
		LEFT JOIN tr_sanpham F ON B.masp = F.masp
		LEFT JOIN tr_nguyenlieu_gva NL ON B.id_nguyenlieu = NL.id
	WHERE maddh IN (SELECT LTRIM(RTRIM([VALUE])) FROM string_split(@maddh, ','))
		AND ISNULL(B.nguyenlieu, '') NOT IN ('', '0')
		AND A.active = 1
		AND B.mact <> '000'
		AND B.dayy_tc > 0
		AND A.chitiet LIKE 'W%'
	GROUP BY B.chitiet, B.nguyenlieu, B.chitiet_ghep2, 
		B.dayy_tc, B.rong_tc, B.dai_tc, 
		B.veneer_canhngan, B.veneer_canhdai,
		B.veneer_matchinh, B.veneer_matphu, B.veneer_dan_canh,
		C.loaihang, D.loaihang, E.loaihang,
		B.dayy_sc,
		B.soluong_tc,
		NL.tilehaohut, NL.congdaiphoi

	SELECT A.*,
		CASE 
			WHEN A.dai_tc > 0 AND A.dai_tc <= 999 THEN N'Ngắn'
			WHEN A.dai_tc >= 1000 AND A.dai_tc <= 1599 THEN N'Trung'
			WHEN A.dai_tc >= 1600 THEN N'Dài'
		END AS loaichitiet
	FROM #TONGHOP_CHITIET A

	DROP TABLE #TONGHOP_CHITIET;
END



