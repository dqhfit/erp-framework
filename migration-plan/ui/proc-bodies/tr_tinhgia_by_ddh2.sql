-- PARAMS:
-- @donhang nvarchar

--DECLARE @donhang nvarchar(max) = 'DQH-VFM01/1125, DQH-VFM02/1125, DQH-VFM10/0126'

CREATE   PROC TR_TINHGIA_BY_DDH2(@donhang nvarchar(max))
AS
BEGIN
	DECLARE @tungay date;
	DECLARE @denngay date;

	-- LẤY RA NGÀY BẮT ĐẦU VÀ NGÀY KẾT THÚC CỦA CÁC ĐƠN HÀNG
	SELECT @tungay = MIN(ngaythang), @denngay = MAX(ngaythang) FROM tr_trangthai_sanxuat A
	WHERE A.madonhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@donhang, ','))

	-- CHỈ TÍNH CỦA CÁC CÔNG ĐOẠN NÀY
	DECLARE @congdoan nvarchar(max);
	SET @congdoan = N'PHOI1, DP09, DBDH, LR02, NHA01'

	-- LẤY LƯƠNG BÌNH QUÂN 1 NGÀY CỦA 1 NGƯỜI THEO BỘ PHẬN
	DECLARE @LUONG_BO_PHAN TABLE
	(
		BOPHAN NVARCHAR(50),
		TONHOM NVARCHAR(50),
		LUONG DECIMAL(18, 2),
		LUONG1 DECIMAL(18, 2),
		LUONG1NGAY DECIMAL(18, 2)
	)

	INSERT INTO @LUONG_BO_PHAN (BOPHAN, TONHOM, LUONG, LUONG1, LUONG1NGAY)
	EXEC HR_NHANVIEN2_LUONG_THEO_BOPHAN

	-- LẤY SỐ NGƯỜI HIỆN DIỆN TỪ NGÀY, ĐẾN NGÀY
	SELECT A.macongdoan, A.ngaythang, A.songuoi_hiendien_hc AS songuoi_hiendien
	INTO #BAOCAO_HIENDIEN
	FROM tr_muctieu_sanxuat2_chitiet A
	WHERE A.ngaythang BETWEEN @tungay AND @denngay
		AND COALESCE(A.songuoi_hiendien_hc, 0) > 0
	--ORDER BY A.macongdoan, A.ngaythang

	-- LẤY SỐ KHỐI HOÀN THÀNH CỦA CÁC ĐƠN HÀNG
	SELECT B.c_op AS macongdoan, A.ngaythang, A.madonhang, C.hehang,
		SUM(CASE
			WHEN A.mact = '000' THEN A.soluong * A.sokhoi
			WHEN COALESCE(A.nguyenlieu, '') NOT IN ('', '0') AND A.mact <> '000' THEN A.sokhoi
			ELSE 0
		END) AS sokhoi
	INTO #TRANGTHAI_SANXUAT
	FROM tr_trangthai_sanxuat A
		INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
		INNER JOIN tr_sanpham C ON A.masp1 = C.masp
	WHERE B.c_op IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@congdoan,',')) 
		AND A.congdoan LIKE '%-PROD'
		AND A.donhang_sanxuat IS NULL
		AND A.ngaythang BETWEEN @tungay AND @denngay
		--AND A.madonhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@donhang, ','))
	GROUP BY B.c_op, A.ngaythang, A.madonhang, C.hehang

	-- LIÊN KẾT BẢNG SỐ LƯỢNG THỐNG KÊ (SỐ KHỐI) VÀ BÁO CÁO HIỆN DIỆN (SỐ NGƯỜI)
	SELECT A.macongdoan, A.ngaythang, A.madonhang, A.hehang, A.sokhoi, B.songuoi_hiendien
	INTO #TRANGTHAI_SANXUAT2
	FROM #TRANGTHAI_SANXUAT A
		INNER JOIN #BAOCAO_HIENDIEN B ON A.macongdoan = B.macongdoan AND A.ngaythang = B.ngaythang

	-- TÍNH TOÁN PHẦN TRĂM SỐ KHỐI HOÀN THÀNH THEO NGÀY - CÔNG ĐOẠN
	-- SỐ TIỀN TRUNG BÌNH PHẢI TRẢ TRONG NGÀY THEO SỐ NGƯỜI HIỆN DIỆN
	SELECT A.macongdoan, A.ngaythang, A.madonhang, A.hehang, A.sokhoi, A.songuoi_hiendien, A.LUONG1NGAY, A.phantram,
		thanhtien = A.LUONG1NGAY * A.phantram
	INTO #TRANGTHAI_SANXUAT3
	FROM (
	SELECT A.macongdoan, A.ngaythang, A.madonhang, A.hehang, A.sokhoi, A.songuoi_hiendien, LUONG1NGAY = B.LUONG1NGAY * A.songuoi_hiendien,
		phantram = A.sokhoi / SUM(A.sokhoi) OVER (PARTITION BY A.ngaythang, A.macongdoan)
	FROM #TRANGTHAI_SANXUAT2 A
		LEFT JOIN @LUONG_BO_PHAN B ON A.macongdoan = CASE 
														WHEN B.TONHOM = 'DINHHINH' THEN 'DBDH' 
														WHEN B.TONHOM = 'LAPRAP' THEN 'LR02' 
														WHEN B.TONHOM = 'NGUOI' THEN 'NHA01' 
														WHEN B.TONHOM = 'PHOI1' THEN 'PHOI1' 
														WHEN B.TONHOM = 'PHOI2' THEN 'DP09' 
														ELSE B.TONHOM
													END
	) A
	ORDER BY A.ngaythang, A.macongdoan

	--SELECT A.macongdoan, A.madonhang, SUM(A.sokhoi) AS sokhoi, FORMAT(SUM(thanhtien), '#,0.##') AS thanhtien
	--FROM #TRANGTHAI_SANXUAT3 A
	--GROUP BY A.macongdoan, A.madonhang
	SELECT A.macongdoan, B.n_op AS tencongdoan, A.ngaythang, A.madonhang, A.hehang, A.sokhoi, A.songuoi_hiendien, A.LUONG1NGAY, A.phantram, A.thanhtien
	FROM #TRANGTHAI_SANXUAT3 A
		LEFT JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE A.madonhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@donhang, ','))
	ORDER BY A.madonhang, A.ngaythang

	DROP TABLE #BAOCAO_HIENDIEN, #TRANGTHAI_SANXUAT, #TRANGTHAI_SANXUAT2, #TRANGTHAI_SANXUAT3;
END

