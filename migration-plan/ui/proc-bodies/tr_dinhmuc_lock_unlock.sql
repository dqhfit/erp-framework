-- PARAMS:
-- (khong co tham so)



CREATE PROC TR_DINHMUC_LOCK_UNLOCK
AS
DECLARE @loaidinhmuc nvarchar(50)
DECLARE @masp nvarchar(200)
DECLARE CUR CURSOR LOCAL FOR
	SELECT loaidinhmuc, masp
	FROM tr_dinhmuc_lock
	WHERE isLock = 1
OPEN CUR
FETCH NEXT FROM CUR INTO @loaidinhmuc, @masp
WHILE @@FETCH_STATUS = 0
BEGIN
	DECLARE @CNT INT
	SET @CNT = 0

	IF @loaidinhmuc = 'NKI'
	BEGIN
		SELECT @CNT = COUNT(LenhCapPhatID) FROM tr_lenhcapphat
		WHERE active = 1 AND LoaiDonHang = 'NKI' 
			AND LoaiCapPhat IN ('BEFORE', 'AFTER', 'AI', 'TRUOCSON', 'SAUSON')
			AND capphat = 0
			AND CASE WHEN LEN(master_code) > 0 THEN master_code ELSE masp END = @masp
	END
	ELSE IF @loaidinhmuc = 'DGO'
	BEGIN
		SELECT @CNT = COUNT(LenhCapPhatID) FROM tr_lenhcapphat
		WHERE active = 1 AND LoaiDonHang = 'DGO' 
			AND capphat = 0 AND masp = @masp
	END
	ELSE IF @loaidinhmuc = 'SON'
	BEGIN
		SELECT @CNT = COUNT(LenhCapPhatID) FROM tr_lenhcapphat
		WHERE active = 1 AND LoaiDonHang = 'SON' 
			AND LoaiCapPhat IN ('SONTRONG', 'SONNGOAI')
			AND capphat = 0 AND masp = @masp
	END

	--PRINT CONCAT(@masp, ', ', @CNT)

	IF @CNT = 0
	BEGIN
		UPDATE tr_dinhmuc_lock
		SET isLock = 0
		WHERE masp = @masp AND loaidinhmuc = @loaidinhmuc
	END

	FETCH NEXT FROM CUR INTO @loaidinhmuc, @masp
END
CLOSE CUR
DEALLOCATE CUR

