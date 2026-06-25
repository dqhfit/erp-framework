-- PARAMS:
-- @maddh nvarchar

CREATE   PROC [dbo].[DQT_TONGHOP_DONHANG_GET3] (@maddh NVARCHAR (max))
AS
BEGIN
	SELECT A.maddh,
		   IIF(LEN(F.tensp_vn) > 0, F.tensp_vn, F.tensp) as tensp,
		   A.chitiet AS mahtr,
		   b.chitiet,
		   B.nguyenlieu,
		   CASE WHEN B.chitiet_ghep2 = 1 THEN N'CHI TIẾT GHÉP' ELSE N'CHI TIẾT ĂN NGAY' END chitiet_ghep2,
		   B.dayy_tc,
		   B.rong_tc,
		   B.dai_tc,
		   b.soluong_tc,
		   A.soluong * B.soluong_tc AS soluong,
		   m3_tc = (B.dayy_tc * B.rong_tc * B.dai_tc * A.soluong * B.soluong_tc)/ 1000000000,
		   b.ghichu, 
		   B.veneer_canhngan, B.veneer_canhdai,
		   B.veneer_matchinh,
		   B.veneer_matphu,
		   B.veneer_dan_canh,
		   C.loaihang AS MC,
		   D.loaihang AS MP,
		   E.loaihang AS DC
	INTO #TONGHOP_CHITIET
	FROM tr_dondathang_chitiet A
		 INNER JOIN tr_dinhmuc_govan B ON A.masp = B.masp
		 LEFT JOIN tr_baogia_chiphi_veneer C on B.veneer_matchinh = C.id
		 LEFT JOIN tr_baogia_chiphi_veneer D on B.veneer_matphu = D.id
		 LEFT JOIN tr_baogia_chiphi_veneer E on B.veneer_dan_canh = E.id
		 LEFT JOIN tr_sanpham F On B.masp = F.masp
	WHERE maddh IN (SELECT LTRIM (RTRIM ([VALUE])) FROM dbo.fn_Split (@maddh, ','))
		 --AND (COALESCE(B.nguyenlieu, '') NOT IN ('', '0') 
			--OR B.veneer_matchinh IS NOT NULL 
			--OR B.veneer_matphu IS NOT NULL 
			--OR B.veneer_dan_canh IS NOT NULL
		 --)
		  AND A.active = 1
		  AND B.mact <> '000'
		  AND B.dayy_tc > 0
		  AND A.chitiet LIKE 'W%'

	SELECT A.*,
		CASE 
			WHEN A.dai_tc > 0 AND A.dai_tc <= 999 THEN N'Ngắn'
			WHEN A.dai_tc >= 1000 AND A.dai_tc <= 1599 THEN N'Trung'
			WHEN A.dai_tc >= 1600 THEN N'Dài'
		END AS loaichitiet
	FROM #TONGHOP_CHITIET A

	DROP TABLE #TONGHOP_CHITIET;

END




