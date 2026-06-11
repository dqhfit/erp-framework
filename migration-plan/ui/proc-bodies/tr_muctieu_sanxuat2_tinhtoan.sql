-- PARAMS:
-- @nam int
-- @thang int
-- @mabophan nvarchar

--DECLARE @nam int = 2025
--DECLARE @thang int = 6
--DECLARE @mabophan nvarchar(50) = 'DP09'
--GO

CREATE PROC [dbo].[TR_MUCTIEU_SANXUAT2_TINHTOAN]
(
	@nam int,
	@thang int,
	@mabophan nvarchar(50)
)
AS
BEGIN

-- LẤY SỐ NGÀY LÀM VIỆC THEO MỤC THEO
--SELECT muctieu_tonggio1 FROM tr_muctieu_sanxuat2_chitiet
DECLARE @songay_lamviec int;
DECLARE @muctieu_tonggio float;
SELECT @songay_lamviec = COUNT(ngaythang), @muctieu_tonggio = COALESCE(SUM(muctieu_tonggio), 0)
FROM tr_muctieu_sanxuat2_chitiet
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang AND muctieu_sogio > 0

DECLARE @songuoi int;
--DECLARE @socont_roi_khongtangca float;
DECLARE @tile_muc1 float;
DECLARE @socont_rap_khongtangca float;
SELECT @songuoi = songuoi,
	--@sokhoi_muctieu_khongtangca = col5,
	--@socont_roi_khongtangca = col1,
	@socont_rap_khongtangca = col2,
	@tile_muc1 = col6
FROM tr_muctieu_sanxuat2 WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan AND mucthuong = 1

DECLARE @sokhoi_muctieu1_khongtangca float;
DECLARE @sogio_muctieu_khongtangca float;
DECLARE @tonggio_thucte float;
DECLARE @tongsokhoi_thucte float;
--SET @sogio_muctieu_khongtangca = @songuoi * @songay_lamviec * 8;
SELECT @sogio_muctieu_khongtangca = SUM(muctieu_tonggio_hc), @tonggio_thucte = SUM(tonggio)
FROM tr_muctieu_sanxuat2_chitiet
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

--SET @tile_muctieu_khongtangca = IIF(@sogio_muctieu_khongtangca = 0, 0, @sokhoi_muctieu_khongtangca / @sogio_muctieu_khongtangca * 8);
SET @sokhoi_muctieu1_khongtangca = (@tile_muc1/8)*@sogio_muctieu_khongtangca;

-- lưu giá trị
UPDATE tr_muctieu_sanxuat2
SET songay = @songay_lamviec, 
	col4 = @sogio_muctieu_khongtangca, -- số giờ mục tiêu không tăng ca
	--col6 = IIF(@sogio_muctieu_khongtangca = 0, 0, col5 / @sogio_muctieu_khongtangca * 8), -- tỉ lệ mục tiêu không tăng ca
	col10 = @muctieu_tonggio, -- số giờ mục tiêu có tăng ca,
	col13 = @tonggio_thucte,
	col5 = IIF(mucthuong = 1, @sokhoi_muctieu1_khongtangca, @sokhoi_muctieu1_khongtangca + (phantram_tang * @sokhoi_muctieu1_khongtangca)/100)
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

UPDATE tr_muctieu_sanxuat2
SET col11 = col10 * (col5/col4)
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan


UPDATE tr_muctieu_sanxuat2
SET col6 = IIF(mucthuong = 1, col6, col5/col4*8)
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

UPDATE tr_muctieu_sanxuat2
SET col1 = (col5-col2*10)/35
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

UPDATE tr_muctieu_sanxuat2
SET col3 = col1 + col2
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

-- update số khối theo tăng ca bảng tr_muctieu_sanxuat2_chitiet
DECLARE @tile_muctieu_khongtangca float;
SELECT @tile_muctieu_khongtangca = col6 FROM tr_muctieu_sanxuat2
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan AND mucthuong = 1



UPDATE tr_muctieu_sanxuat2_chitiet
SET muctieu_sokhoi_theo_hc = muctieu_tonggio_hc * (@tile_muc1/8)
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

UPDATE tr_muctieu_sanxuat2_chitiet
SET sokhoi = (@tile_muc1/8) * tonggio -- muctieu_sokhoi_theo_hc * IIF(muctieu_tonggio_hc = 0, 0, tonggio/muctieu_tonggio_hc)
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

--UPDATE tr_muctieu_sanxuat2_chitiet
--SET tile = IIF(COALESCE(tonggio,0) = 0, 0, sokhoi / tonggio) * 8
--WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

UPDATE tr_muctieu_sanxuat2_chitiet
SET tile_hoanthanh = IIF(tonggio = 0, 0, sokhoi_hoanthanh / tonggio) * 8
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang


--DECLARE @idChiTiet uniqueidentifier;
--DECLARE @muctieu_tonggio_tangca1 float;
--DECLARE CUR_MUCTIEU_CT CURSOR LOCAL FOR
--	SELECT id, muctieu_tonggio1
--	FROM tr_muctieu_sanxuat2_chitiet
--	WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang
--OPEN CUR_MUCTIEU_CT;
--FETCH NEXT FROM CUR_MUCTIEU_CT INTO @idChiTiet, @muctieu_tonggio_tangca1;
--WHILE @@FETCH_STATUS = 0
--BEGIN
--	UPDATE tr_muctieu_sanxuat2_chitiet
--	SET muctieu_sokhoi_theo_tangca = @muctieu_tonggio_tangca1 * @tile_muctieu_khongtangca / 8
--	WHERE id = @idChiTiet

--	FETCH NEXT FROM CUR_MUCTIEU_CT INTO @idChiTiet, @muctieu_tonggio_tangca1;
--END
--CLOSE CUR_MUCTIEU_CT;
--DEALLOCATE CUR_MUCTIEU_CT;

DECLARE @muctieu_sokhoi_theo_tangca float = 0;
DECLARE @muctieu_tonggio_khongtangca1 float;
SELECT @muctieu_sokhoi_theo_tangca = SUM(muctieu_sokhoi_theo_tangca), 
	@muctieu_tonggio_khongtangca1 = SUM(muctieu_tonggio)
FROM tr_muctieu_sanxuat2_chitiet
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

UPDATE tr_muctieu_sanxuat2_chitiet
SET muctieu_sokhoi_trungbinh = @muctieu_sokhoi_theo_tangca / @muctieu_tonggio_khongtangca1 * (IIF(day_names <> 'Sun', muctieu_songuoi * 8, 0) + (muctieu_songuoi_tangca_15 * muctieu_sogio_tangca_15) + (muctieu_songuoi_tangca_20 * muctieu_sogio_tangca_20))
	--tile = IIF(tonggio = 0, 0, (IIF(muctieu_tonggio1 = 0, 0, muctieu_sokhoi_trungbinh * tonggio / muctieu_tonggio1) / tonggio) * 8)
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

	--UPDATE tr_muctieu_sanxuat2_chitiet
	--SET sokhoi = IIF(muctieu_tonggio1 = 0, 0, muctieu_sokhoi_trungbinh * tonggio / muctieu_tonggio1)
	--WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

	--UPDATE tr_muctieu_sanxuat2_chitiet
	--SET tile = IIF(tonggio = 0, 0, (IIF(muctieu_tonggio1 = 0, 0, muctieu_sokhoi_trungbinh * tonggio / muctieu_tonggio1) / tonggio) * 8)
	--WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

	--UPDATE tr_muctieu_sanxuat2_chitiet
	--SET tile_hoanthanh = IIF(tonggio = 0, 0, sokhoi_hoanthanh / tonggio) * 8
	--WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

--DECLARE @socont_roi_tangca float;
--DECLARE @socont_rap_tangca float;
--DECLARE @sokhoi_muctieu_tangca_muc float;

--UPDATE tr_muctieu_sanxuat2
--SET col11 = @muctieu_sokhoi_theo_tangca + (COALESCE(phantram_tang, 0) *  @muctieu_sokhoi_theo_tangca) / 100 -- IIF(mucthuong = 1, @muctieu_sokhoi_theo_tangca, @muctieu_sokhoi_theo_tangca + (phantram_tang*@muctieu_sokhoi_theo_tangca))
--WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan


SELECT @tonggio_thucte = SUM(tonggio),
	@tongsokhoi_thucte = SUM(sokhoi)
FROM tr_muctieu_sanxuat2_chitiet
WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang

UPDATE tr_muctieu_sanxuat2
SET col7 = IIF(col5 = 0, 0, col1 * (col11 / col5)),
	col8 = IIF(col5 = 0, 0, col2 * (col11 / col5)),
	col9 = IIF(col5 = 0, 0, col1 * (col11 / col5)) + IIF(col5 = 0, 0, col2 * (col11 / col5)),
	col12 = IIF(col10 = 0, 0, col11 / col10 * 8),
	--col13 = @tonggio_thucte,
	col14 = IIF(mucthuong = 1, @tongsokhoi_thucte, @tongsokhoi_thucte + ((phantram_tang * @tongsokhoi_thucte) / 100))
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

DECLARE @sokhoi_hoanthanh float;
DECLARE @cont_roi float;
DECLARE @cont_rap float;
SELECT @sokhoi_hoanthanh = SUM(sokhoi_hoanthanh),
	@cont_roi = SUM(cont_roi),
	@cont_rap = SUM(cont_rap)
FROM tr_muctieu_sanxuat2_chitiet
WHERE YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang AND macongdoan = @mabophan

UPDATE tr_muctieu_sanxuat2
SET col15 = IIF(col13 = 0, 0, col14 / col13) * 8,
	col16 = COALESCE(@sokhoi_hoanthanh, 0) + COALESCE(col24, 0),
	--col17 = COALESCE(IIF(col13 = 0, 0, @sokhoi_hoanthanh / col13) * 8, 0),
	col22 = COALESCE(@cont_roi, 0),
	col23 = COALESCE(@cont_rap, 0)
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

UPDATE tr_muctieu_sanxuat2
SET col17 = IIF(col13 = 0, 0, (col16 / col13)) * 8
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan

UPDATE tr_muctieu_sanxuat2
SET col18 = IIF(COALESCE(col17,0) = 0, '', IIF(col17 >= col15, N'Đạt', '')) 
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan


DECLARE @tongnguoi_hc float;
DECLARE @tongnguoi_tc float;
DECLARE @tongngay_hc float;
DECLARE @tongngay_tc float;

-- TỔNG SỐ NGƯỜI, SỐ NGÀY HIỆN DIỆN
SELECT @tongnguoi_hc = COALESCE(SUM(songuoi_hiendien_hc), 0), @tongngay_hc = COALESCE(COUNT(ngaythang), 0)
FROM tr_muctieu_sanxuat2_chitiet
WHERE YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang 
	AND macongdoan = @mabophan
	AND songuoi_hiendien_hc > 0

-- TỔNG SỐ NGƯỜI, SỐ NGÀY HIỆN DIỆN TĂNG CA
SELECT @tongnguoi_tc = COALESCE(SUM(songuoi_hiendien_tc), 0), @tongngay_tc = COALESCE(COUNT(ngaythang), 0)
FROM tr_muctieu_sanxuat2_chitiet
WHERE YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang 
	AND macongdoan = @mabophan
	AND songuoi_hiendien_tc > 0

-- TÍNH SỐ NGƯỜI TRUNG BÌNH
DECLARE @songuoi_trungbinh float;
SET @songuoi_trungbinh = IIF(@tongngay_hc + @tongngay_tc > 0, (@tongnguoi_hc + @tongnguoi_tc) / (@tongngay_hc + @tongngay_tc), 0);

UPDATE tr_muctieu_sanxuat2
SET col19 = IIF(@tongngay_hc = 0, 0, col13 / songay / 8), -- @songuoi_trungbinh,
	col21 = col20 * (IIF(@tongngay_hc = 0, 0, col13 / songay / 8))
WHERE nam = @nam AND thang = @thang AND mabophan = @mabophan
	
-- tính giờ cần bù
DECLARE @idChiTiet uniqueidentifier;
DECLARE @giochenhlech float;
DECLARE @ngaythang date;
DECLARE @songuoi_hiendien_hc int;
DECLARE @giocanbu float = 0;
DECLARE CUR_MUCTIEU_CT CURSOR LOCAL FOR
	SELECT id, giochenhlech, ngaythang, songuoi_hiendien_hc
	FROM tr_muctieu_sanxuat2_chitiet
	WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang
	ORDER BY ngaythang
OPEN CUR_MUCTIEU_CT;
FETCH NEXT FROM CUR_MUCTIEU_CT INTO @idChiTiet, @giochenhlech, @ngaythang, @songuoi_hiendien_hc;
WHILE @@FETCH_STATUS = 0
BEGIN
	--UPDATE tr_muctieu_sanxuat2_chitiet
	--SET muctieu_sokhoi_theo_tangca = @muctieu_tonggio_tangca1 * @tile_muctieu_khongtangca / 8
	--WHERE id = @idChiTiet

	SET @giocanbu = @giocanbu + @giochenhlech;
	IF @songuoi_hiendien_hc > 0
	BEGIN
		
		UPDATE tr_muctieu_sanxuat2_chitiet
		SET giocanbu = @giocanbu
		WHERE id = @idChiTiet
	END

	FETCH NEXT FROM CUR_MUCTIEU_CT INTO @idChiTiet, @giochenhlech, @ngaythang, @songuoi_hiendien_hc;
END
CLOSE CUR_MUCTIEU_CT;
DEALLOCATE CUR_MUCTIEU_CT;

END

