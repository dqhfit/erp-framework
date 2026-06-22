-- PARAMS:
-- @LenhCapPhatID nvarchar OUTPUT
-- @MaDonHang nvarchar
-- @MaSP nvarchar
-- @MaHTR nvarchar
-- @LoaiCapPhat nvarchar
-- @DinhMuc nvarchar
-- @NguoiTao nvarchar
-- @NgayTao datetime
-- @NguoiSua nvarchar
-- @NgaySua datetime



CREATE   PROC [dbo].[TR_LENHCAPPHAT_CREATE]
(
	@LenhCapPhatID nvarchar(50) OUT,
	@MaDonHang nvarchar(100),
	@MaSP nvarchar(200),
	@MaHTR nvarchar(200),
	@LoaiCapPhat nvarchar(50),
	@DinhMuc nvarchar(10),
	@NguoiTao nvarchar(50),
	@NgayTao datetime,
	@NguoiSua nvarchar(50),
	@NgaySua datetime
)
AS

--DECLARE @MaDonHang nvarchar(100) = 'DQH-78'
--DECLARE @MaSP nvarchar(200) = '5317VN_EDC001_EPO'
--DECLARE @MaHTR nvarchar(200)
--DECLARE @LoaiCapPhat nvarchar(50) = 'BEFORE'
--DECLARE @DinhMuc nvarchar(10) = 'NKI'
--DECLARE @NguoiTao nvarchar(50) = 'cuongpv'
--DECLARE @NgayTao datetime = GETDATE()
--DECLARE @NguoiSua nvarchar(50) = 'cuongpv'
--DECLARE @NgaySua datetime = GETDATE()

--DECLARE @LenhCapPhatID nvarchar(50)
DECLARE @LoaiDonHang nvarchar(50)
DECLARE @MaDonDatHang nvarchar(50)
DECLARE @COUNT INT


SELECT @LenhCapPhatID = LenhCapPhatID 
FROM tr_lenhcapphat_head
WHERE LoaiDonHang = @DinhMuc 
	AND MaDonDatHang = @MaDonHang 
	AND LoaiCapPhat = @LoaiCapPhat

SELECT @COUNT = COUNT(LenhCapPhatID) 
FROM tr_lenhcapphat_head
WHERE FORMAT(ngaytao, 'yyyyMMdd') = FORMAT(@NgayTao, 'yyyyMMdd')

IF @COUNT IS NULL
	SET @COUNT = 0

IF @LenhCapPhatID IS NULL
BEGIN
	SET @LenhCapPhatID = 'LCP' + FORMAT(@NgayTao, 'ddMMyy') + FORMAT(@COUNT + 1, 'D2')
	INSERT INTO tr_lenhcapphat_head
	(
		LenhCapPhatID, 
		LoaiDonHang,
		LoaiCapPhat,
		MaDonDatHang, 
		hoanthanh, vuotdinhmuc, active, 
		nguoitao, ngaytao,
		nguoisua, ngaysua
	)
	VALUES
	(
		@LenhCapPhatID,
		@DinhMuc,
		@LoaiCapPhat,
		@MaDonHang,
		0, 0, 1, 
		@NguoiTao, @NgayTao,
		@NguoiSua, @NgaySua
	)
END
ELSE
BEGIN
	UPDATE tr_lenhcapphat_head
	SET ngaysua = @NgaySua, nguoisua = @NguoiSua
	WHERE LenhCapPhatID = @LenhCapPhatID
END

--print 'lcp: ' + @LenhCapPhatID
-- KIỂM TRA MÃ ĐƠN HÀNG LÀ ĐƠN MUA HAY ĐƠN SẢN XUẤT
IF EXISTS (SELECT id FROM tr_order WHERE order_number = @MaDonHang)
BEGIN
	SET @LoaiDonHang = 'SX';
	SET @MaDonDatHang = NULL;
END
ELSE
BEGIN
	SET @LoaiDonHang = 'HTR';
	SET @MaDonDatHang = @MaDonHang

	SELECT @MaDonHang = IIF(LEN(donhang) > 0, donhang, maddh) 
	FROM tr_dondathang WHERE maddh = @MaDonDatHang
END

DECLARE @SOLUONG_DONHANG INT
IF @LoaiDonHang = 'SX'
BEGIN
	print 'SOLUONG_SANXUAT'
	SELECT @SOLUONG_DONHANG = SUM(order_qty)
	FROM tr_order_detail
	WHERE order_number = @MaDonHang
		AND f_cancelled = 'N'
		AND item_number = @MaSP
END
ELSE IF @LoaiDonHang = 'HTR'
BEGIN
	print 'SOLUONG_HANGTRANG'
	SELECT @SOLUONG_DONHANG = SUM(soluong) 
	FROM tr_dondathang_chitiet
	WHERE maddh = @MaDonDatHang AND chitiet = @MaHTR AND active = 1
END

IF @SOLUONG_DONHANG IS NULL
	SET @SOLUONG_DONHANG = 0

print @SOLUONG_DONHANG

IF @SOLUONG_DONHANG > 0
BEGIN
	DECLARE @TBDINHMUC TABLE
	(
		MaCT nvarchar(200),
		SoLuong_DinhMuc decimal(18, 5)
	)

	IF @DinhMuc = 'NKI'
	BEGIN
		IF @LoaiCapPhat = 'BEFORE'
		BEGIN
			INSERT INTO @TBDINHMUC(MaCT, SoLuong_DinhMuc)
			SELECT mavt, SUM(soluong) 
			FROM tr_dinhmuc_ngukim
			WHERE masp = @MaSP AND HWforWW = 1
			GROUP BY mavt
		END
		ELSE IF @LoaiCapPhat = 'AFTER'
		BEGIN
			INSERT INTO @TBDINHMUC(MaCT, SoLuong_DinhMuc)
			SELECT mavt, SUM(soluong) 
			FROM tr_dinhmuc_ngukim
			WHERE masp = @MaSP AND HWforPacking = 1
			GROUP BY mavt
		END
		ELSE IF @LoaiCapPhat = 'AI'
		BEGIN
			INSERT INTO @TBDINHMUC(MaCT, SoLuong_DinhMuc)
			SELECT mavt, SUM(soluong) 
			FROM tr_dinhmuc_ngukim
			WHERE masp = @MaSP AND HWforAI = 1
			GROUP BY mavt
		END
	END
	ELSE IF @DinhMuc = 'DGO'
	BEGIN
		INSERT INTO @TBDINHMUC(MaCT, SoLuong_DinhMuc)
		SELECT madonggoi, SUM(soluong) FROM tr_dinhmuc_donggoi
		WHERE masp = @MaSP
		GROUP BY madonggoi
	END
	ELSE IF @DinhMuc = 'SON'
	BEGIN
		IF @LoaiCapPhat = 'SONTRONG'
		BEGIN
			INSERT INTO @TBDINHMUC(MaCT, SoLuong_DinhMuc)
			SELECT mact, SUM(sl_sp) FROM tr_dinhmuc_son
			WHERE masp = @MaSP AND sontrongsanpham = 1
			GROUP BY mact
		END
		ELSE IF @LoaiCapPhat = 'SONNGOAI'
		BEGIN
			INSERT INTO @TBDINHMUC(MaCT, SoLuong_DinhMuc)
			SELECT mact, SUM(sl_sp) FROM tr_dinhmuc_son
			WHERE masp = @MaSP AND sontrongsanpham = 0
			GROUP BY mact
		END
		ELSE IF @LoaiCapPhat = 'UV'
		BEGIN
			SELECT b.mact, SUM(COALESCE(A.m2_son,0) * COALESCE(B.dinhluong,0)/1000)
			FROM tr_sanpham A INNER JOIN tr_quytrinh_lanuv B ON A.mauuv = B.bangmau AND COALESCE(B.mact, '') <> ''
			WHERE A.masp = @MaSP
			GROUP BY b.mact
		END
	END

	
	DECLARE @MaCT nvarchar(200)
	DECLARE @SoLuong_DinhMuc decimal(18, 5)
	
	BEGIN TRANSACTION
	BEGIN TRY
		IF @LoaiDonHang = 'SX'
		BEGIN
			UPDATE tr_lenhcapphat
			SET active = 0
			WHERE LenhCapPhatID = @LenhCapPhatID AND masp = @MaSP
		END
		ELSE
		BEGIN
			UPDATE tr_lenhcapphat
			SET active = 0
			WHERE LenhCapPhatID = @LenhCapPhatID AND master_code = @MaSP AND masp = @MaHTR
		END

		DECLARE CUR CURSOR LOCAL FOR
			SELECT MaCT, SoLuong_DinhMuc FROM @TBDINHMUC
		OPEN CUR
		FETCH NEXT FROM CUR INTO @MaCT, @SoLuong_DinhMuc
		WHILE @@FETCH_STATUS = 0
		BEGIN
			DECLARE @ID int
			DECLARE @SoLuong_DaNhan decimal(18, 5)
			DECLARE @SoLuong_Can decimal(18, 5)
			DECLARE @SoLuong_ConLai decimal(18, 5)

			SET @ID = 0;
			SET @SoLuong_Can = 0;
			SET @SoLuong_DaNhan = 0;
			SET @SoLuong_ConLai = 0;
			SET @SoLuong_Can = @SoLuong_DinhMuc * @SOLUONG_DONHANG;

			--NẾU MÃ CHI TIẾT TỒN TẠI TRONG tr_lenhcapphat THÌ UPDATE
			--NẾU KHÔNG TỒN TẠI THÌ INSERT
			SELECT @ID = id,
				@SoLuong_DaNhan = soluong_daphat
			FROM tr_lenhcapphat
			WHERE LenhCapPhatID = @LenhCapPhatID
				AND CASE WHEN LEN(MaDonDatHang) > 0 THEN MaDonDatHang ELSE MaDonHang END = @MaDonHang
				AND CASE WHEN @LoaiDonHang = 'SX' THEN masp ELSE master_code END = @MaSP 
				AND mavt = @MaCT
			
			IF @SoLuong_DaNhan IS NULL
				SET @SoLuong_DaNhan = 0
			SET @SoLuong_ConLai = @SoLuong_Can - @SoLuong_DaNhan
			IF @ID IS NULL OR @ID = 0
			BEGIN
				--INSERT
				INSERT INTO tr_lenhcapphat
				(
					LenhCapPhatID,
					LoaiDonHang,
					LoaiCapPhat,
					MaDonDatHang,
					MaDonHang,
					master_code,
					masp,
					mavt,
					soluong_donhang,
					soluong,
					soluong_daphat,
					soluong_conlai,
					nguoitao,
					ngaytao,
					nguoisua, ngaysua,
					active
				) VALUES
				(
					@LenhCapPhatID,
					@DinhMuc,
					@LoaiCapPhat,
					@MaDonDatHang,
					@MaDonHang,
					@MaSP,
					@MaHTR,
					@MaCT,
					@SOLUONG_DONHANG,
					@SoLuong_Can,
					@SoLuong_DaNhan,
					@SoLuong_ConLai,
					@NguoiTao,
					@NgayTao,
					@NguoiSua, @NgaySua,
					1
				)
			END
			ELSE
			BEGIN
				--UPDATE
				UPDATE tr_lenhcapphat
				SET soluong_donhang = @SOLUONG_DONHANG,
					soluong = @SoLuong_Can,
					soluong_daphat = @SoLuong_DaNhan,
					soluong_conlai = @SoLuong_ConLai,
					active = 1,
					nguoisua = @NguoiSua,
					ngaysua = @NgaySua
				WHERE id = @ID
			END

			FETCH NEXT FROM CUR INTO @MaCT, @SoLuong_DinhMuc
		END
		CLOSE CUR
		DEALLOCATE CUR

		IF @@TRANCOUNT > 0
			COMMIT TRANSACTION;

	END TRY
	BEGIN CATCH
		SET @LenhCapPhatID = NULL;
		IF @@TRANCOUNT > 0
			ROLLBACK TRANSACTION;
	END CATCH

END
ELSE
BEGIN
	SET @LenhCapPhatID = NULL;
END


