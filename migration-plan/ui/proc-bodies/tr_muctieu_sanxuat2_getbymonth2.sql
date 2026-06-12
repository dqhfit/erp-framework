-- PARAMS:
-- @nam int
-- @thang int
-- @mabophan nvarchar


CREATE PROC [dbo].[TR_MUCTIEU_SANXUAT2_GETBYMONTH2]
(
	@nam int,
	@thang int,
	@mabophan nvarchar(50)
)
AS
BEGIN
SET NOCOUNT ON;
	BEGIN TRY
		IF @nam IS NULL OR @nam <= 0
		BEGIN
			RAISERROR('Năm không hợp lệ', 16, 1);
			RETURN;
		END

		IF @thang IS NULL OR @thang < 1 OR @thang > 12
        BEGIN
            RAISERROR('Tháng không hợp lệ (1-12)', 16, 1);
            RETURN;
        END

		DECLARE @MUCTHUONG_SANXUAT TABLE
		(
			mabophan nvarchar(50),
			mucthuong int
		)

		INSERT INTO @MUCTHUONG_SANXUAT (mabophan, mucthuong) VALUES (@mabophan, 1), (@mabophan, 2), (@mabophan, 3), (@mabophan, 4)
		
		DECLARE @mucthuong int;
		DECLARE CUR CURSOR LOCAL FOR
			SELECT mucthuong FROM @MUCTHUONG_SANXUAT ORDER BY mucthuong
		OPEN CUR;
		FETCH NEXT FROM CUR INTO @mucthuong;
		WHILE @@FETCH_STATUS = 0
		BEGIN
			DECLARE @songuoi int = 0;
			DECLARE @songay INT = 0;
			
			SELECT @songuoi = songuoi, @songay = songay 
			FROM tr_muctieu_sanxuat2
			WHERE mabophan = @mabophan AND mucthuong = 1 AND nam = @nam AND thang = @thang

			--SELECT @songay = COUNT(ngaythang) FROM tr_muctieu_sanxuat2_chitiet
			--WHERE macongdoan = @mabophan AND YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang AND muctieu_sogio > 0

			IF @songuoi IS NULL
				SET @songuoi = 0;
			IF @songay IS NULL
				SET @songay = 0;

			IF NOT EXISTS (SELECT 1 FROM tr_muctieu_sanxuat2 WHERE mabophan = @mabophan AND mucthuong = @mucthuong AND nam = @nam AND thang = @thang)
			BEGIN
				INSERT INTO tr_muctieu_sanxuat2 (nam, thang, mabophan, songuoi, songay, mucthuong)
				VALUES (@nam, @thang, @mabophan, @songuoi, @songay, @mucthuong)
			END

			FETCH NEXT FROM CUR INTO @mucthuong;
		END
		CLOSE CUR;
		DEALLOCATE CUR;

		SELECT A.*, B.n_op AS tencongdoan 
		FROM tr_muctieu_sanxuat2 A
			INNER JOIN trtb_m_op B ON A.mabophan = B.c_op
		WHERE nam = @nam AND thang = @thang AND A.mabophan = @mabophan
		ORDER BY A.mucthuong

	END TRY
	BEGIN CATCH
		-- Xử lý lỗi
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
	END CATCH
END

