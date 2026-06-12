-- PARAMS:
-- @year int
-- @month int


CREATE PROC [dbo].[TR_THONGKE_SANPHAM_MONITORING3] (@year int, @month int)
AS
BEGIN
	--DECLARE @macongdoan nvarchar(max) = 'DH06';

	-- THÔNG TIN BÁO CÁO SỐ NGƯỜI HIỆN DIỆN
	DECLARE @HIENDIEN TABLE
	(
		macongdoan nvarchar(50),
		ngaythang date,
		songuoi_hanhchanh int,
		songuoi_tangca int
	)

	INSERT INTO @HIENDIEN (macongdoan, ngaythang, songuoi_hanhchanh, songuoi_tangca)
	SELECT macongdoan, ngaythang, songuoi_hanhchanh, IIF(day_names = 'SUN', songuoi_hanhchanh, songuoi_tangca)
	FROM tr_baocao_hiendien4 A
	WHERE YEAR(ngaythang) = @year AND MONTH(ngaythang) = @month

	-- THÔNG TIN MỤC TIÊU SẢN XUẤT
	DECLARE @MUCTIEU TABLE
	(
		macongdoan nvarchar(50),
		ngaythang date,
		day_names nvarchar(50),
		muctieu float,
		songuoi int,
		sogio_hanhchinh float,
		sogio_tangca float,
		tonggiocong float,
		tonggiocong1 AS sogio_hanhchinh + sogio_tangca
		--tile_hanhchinh AS CASE WHEN songuoi = 0 OR sogio_hanhchinh = 0 THEN 0 ELSE muctieu / songuoi / sogio_hanhchinh END
	)

	INSERT INTO @MUCTIEU (macongdoan, ngaythang, day_names, muctieu, songuoi, tonggiocong, sogio_hanhchinh, sogio_tangca)
	SELECT macongdoan, ngaythang, day_names, muctieu, songuoi,
		sogio as tonggiocong,
		sogio_hanhchinh = IIF(day_names = 'SUN', sogio, sogio - sogio_tangca),
		sogio_tangca = IIF(day_names = 'SUN', sogio_tangca, sogio_tangca * 1.5)
	FROM (
		SELECT macongdoan, ngaythang, day_names, muctieu, songuoi, sogio,
			sogio_tangca = CASE
								WHEN day_names = 'SUN' THEN sogio
								ELSE IIF(sogio > 8, (sogio - 8), 0)
							END
		FROM tr_muctieu_sanxuat A
		WHERE YEAR(A.ngaythang) = @year AND MONTH(ngaythang) = @month

	) A


	-- THỐNG KÊ SỐ LƯỢNG
	DECLARE @THONGKE_SOLUONG TABLE
	(
		macongdoan nvarchar(50),
		ngaythang date,
		sokhoi_hoanthanh float
	)

	INSERT INTO @THONGKE_SOLUONG (macongdoan, ngaythang, sokhoi_hoanthanh)
	SELECT C.c_op AS macongdoan, A.ngaythang, SUM(CASE WHEN A.mact = '000' THEN A.soluong * A.sokhoi ELSE A.sokhoi END) AS sokhoi_hoanthanh
	FROM tr_trangthai_sanxuat A
		INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
		INNER JOIN trtb_m_op C ON B.c_op = C.c_op
	WHERE YEAR(A.ngaythang) = @year AND MONTH(A.ngaythang) = @month
		AND A.congdoan LIKE '%-PROD'
	GROUP BY C.c_op, A.ngaythang
	
	INSERT INTO @THONGKE_SOLUONG (macongdoan, ngaythang, sokhoi_hoanthanh)
	SELECT congdoan, ngaythang, SUM(sokhoi) AS sokhoi
	FROM (
		SELECT congdoan, COALESCE(A.ngaysanxuat, CONVERT(date, A.ngaytao)) AS ngaythang, sokhoi
		FROM dqt_pallet_chitiet A
		WHERE A.active = 1 AND A.phanloai = N'Sản xuất'
			AND YEAR(COALESCE(A.ngaysanxuat, CONVERT(date, A.ngaytao))) = @year
			AND MONTH(COALESCE(A.ngaysanxuat, CONVERT(date, A.ngaytao))) = @month
	) A
	GROUP BY congdoan, ngaythang

	-- TÍNH TOÁN TỈ LỆ SỐ KHỐI 1 NGƯỜI LÀM ĐƯỢC TRONG 1 TIẾNG LÀM VIỆC HÀNH CHÍNH
	DECLARE @TILE_MUCTIEU TABLE
	(
		macongdoan nvarchar(50),
		muctieu float,
		songuoi int,
		tile float
	)

	INSERT INTO @TILE_MUCTIEU (macongdoan, muctieu, songuoi, tile)
	SELECT A.macongdoan, muctieu, songuoi, 
		tile = COALESCE(CASE WHEN songuoi = 0 THEN 0 ELSE muctieu / songuoi / 8 END, 0)
	FROM (
		SELECT macongdoan, SUM(muctieu) AS muctieu, SUM(songuoi) AS songuoi
		FROM @MUCTIEU A
		WHERE day_names != 'SUN' AND tonggiocong = 8
		GROUP BY macongdoan
	) A

	-- BẢNG TỔNG HỢP
	SELECT A.macongdoan, B.n_op AS tencongdoan, A.ngaythang, A.day_names,
		A.songuoi_muctieu, A.songuoi_hanhchanh, A.songuoi_tangca,
		A.sogio_hanhchinh, A.sogio_tangca,
		A.muctieu_hanhchinh, A.muctieu_tangca,
		A.sokhoi_hoanthanh,
		ketqua = CASE 
					WHEN A.sokhoi_hoanthanh = A.muctieu_hanhchinh + A.muctieu_tangca AND A.tile > 0 THEN N'ĐẠT' 
					WHEN A.sokhoi_hoanthanh > A.muctieu_hanhchinh + A.muctieu_tangca AND A.tile > 0 THEN N'VƯỢT' 
					ELSE N'KHÔNG ĐẠT'
				END,
		A.tile
	FROM (
		SELECT A.macongdoan, A.ngaythang, A.day_names, A.muctieu, 
			A.songuoi AS songuoi_muctieu, 
			C.songuoi_hanhchanh, 
			songuoi_tangca = CASE WHEN A.sogio_tangca > 0 AND COALESCE(C.songuoi_tangca, 0) = 0 THEN C.songuoi_hanhchanh ELSE C.songuoi_tangca END,
			A.sogio_hanhchinh, 
			A.sogio_tangca, 
			muctieu_hanhchinh = ROUND(COALESCE(C.songuoi_hanhchanh * A.sogio_hanhchinh * B.tile, 0), 2),
			--muctieu_tangca = ROUND(COALESCE(C.songuoi_tangca * A.sogio_tangca * B.tile, 0), 2),
			muctieu_tangca = ROUND (B.tile * A.sogio_tangca * CASE WHEN A.sogio_tangca > 0 AND COALESCE(C.songuoi_tangca, 0) = 0 THEN C.songuoi_hanhchanh ELSE C.songuoi_tangca END, 2),
			sokhoi_hoanthanh = ROUND(D.sokhoi_hoanthanh, 2),
			B.tile
		FROM @MUCTIEU A
			LEFT JOIN @HIENDIEN C ON A.macongdoan = C.macongdoan AND A.ngaythang = C.ngaythang
			LEFT JOIN @TILE_MUCTIEU B ON A.macongdoan = B.macongdoan
			LEFT JOIN @THONGKE_SOLUONG D ON A.macongdoan = D.macongdoan AND A.ngaythang = D.ngaythang
		--ORDER BY A.macongdoan, A.ngaythang
	) A LEFT JOIN trtb_m_op B ON A.macongdoan = B.c_op
	--WHERE A.macongdoan IN (SELECT LTRIM(RTRIM(value)) FROM string_split(@macongdoan, ','))
	ORDER BY A.macongdoan, A.ngaythang
END

