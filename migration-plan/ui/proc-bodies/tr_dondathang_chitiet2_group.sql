-- PARAMS:
-- @dondathang nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoisua nvarchar
-- @ngaysua datetime


CREATE PROC [dbo].[TR_DONDATHANG_CHITIET2_GROUP]
(
	@dondathang nvarchar(50),
	@nguoitao nvarchar(50),
	@ngaytao datetime,
	@nguoisua nvarchar(50),
	@ngaysua datetime
)
AS
BEGIN
	DECLARE @maddh NVARCHAR(200)
	DECLARE @id_maddhmaddh NVARCHAR(200)
	DECLARE @masp NVARCHAR(200)
	DECLARE @chitiet NVARCHAR(200)
	DECLARE @tenchitiet NVARCHAR(MAX)
	DECLARE @dvt NVARCHAR(50)
	DECLARE @dongia DECIMAL(18, 3)
	DECLARE @loaitien NVARCHAR(50)
	DECLARE @ngaycangiao DATE
	DECLARE @fsc_id INT
	DECLARE @soluong DECIMAL(18, 3)
	DECLARE @sl_danhan DECIMAL(18, 3)
	DECLARE @sl_conlai DECIMAL(18, 3)
	DECLARE @ghichu NVARCHAR(MAX)
	DECLARE @donhang NVARCHAR(MAX)
	DECLARE @idChiTiet2 nvarchar(max)
	DECLARE @dayy FLOAT, @rong FLOAT, @dai FLOAT, @dongia_m3 FLOAT
	DECLARE @nguyenlieu NVARCHAR(50)
	DECLARE @tygia decimal(18, 3);

	DECLARE CUR CURSOR LOCAL FOR
		SELECT maddh, id_maddhmaddh, masp, chitiet, tenchitiet, dvt, dongia, loaitien,
			ngaycangiao, fsc_id,
			dayy, rong, dai, nguyenlieu, dongia_m3,
			SUM(soluong) AS soluong,
			SUM(sl_danhan) AS sl_danhan,
			SUM(sl_conlai) AS sl_conlai,
			STRING_AGG(ghichu, '; ') AS ghichu,
			STRING_AGG(donhang, ', ') AS donhang,
			STRING_AGG(id, ',') AS id,
			SUM(DISTINCT tygia) AS tygia
		FROM tr_dondathang_chitiet2
		WHERE maddh = @dondathang
		GROUP BY maddh, id_maddhmaddh, masp, chitiet, tenchitiet, dvt, dongia, loaitien, ngaycangiao, fsc_id, dayy, rong, dai, nguyenlieu, dongia_m3
		ORDER BY masp, chitiet
	OPEN CUR;
	FETCH NEXT FROM CUR INTO @maddh, @id_maddhmaddh, @masp, @chitiet, @tenchitiet, @dvt, @dongia, @loaitien, @ngaycangiao, @fsc_id, @dayy, @rong, @dai, @nguyenlieu, @dongia_m3, @soluong, @sl_danhan, @sl_conlai, @ghichu, @donhang, @idChiTiet2, @tygia;
	WHILE @@FETCH_STATUS = 0
	BEGIN
		INSERT INTO tr_dondathang_chitiet
		(
			maddh, masp, chitiet, tenchitiet, soluong, dvt, sl_danhan, sl_conlai, dongia, thanhtien, loaitien, 
			donhang, ghichu, active, id_maddhmaddh,
			dayy, rong, dai, nguyenlieu, dongia_m3,
			ngaycangiao, fsc_id, idChiTiet2,
			create_date, create_by, update_date, update_by,
			tygia
		)
		VALUES
		(
			@maddh, @masp, @chitiet, @tenchitiet, @soluong, @dvt, @sl_danhan, @sl_conlai, @dongia, @soluong * @dongia, @loaitien,
			@donhang, @ghichu, 1, @id_maddhmaddh, 
			@dayy, @rong, @dai, @nguyenlieu, @dongia_m3,
			@ngaycangiao, @fsc_id, @idChiTiet2,
			@ngaytao, @nguoitao, @ngaysua, @nguoisua,
			@tygia
		)

		UPDATE tr_dondathang_chitiet2
		SET idChiTiet2 = @idChiTiet2
		WHERE id IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@idChiTiet2, ','))

		FETCH NEXT FROM CUR INTO @maddh, @id_maddhmaddh, @masp, @chitiet, @tenchitiet, @dvt, @dongia, @loaitien, @ngaycangiao, @fsc_id, @dayy, @rong, @dai, @nguyenlieu, @dongia_m3, @soluong, @sl_danhan, @sl_conlai, @ghichu, @donhang, @idChiTiet2, @tygia;
	END
	CLOSE CUR;
	DEALLOCATE CUR;

END
