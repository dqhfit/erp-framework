-- PARAMS:
-- @nam int
-- @thang int


CREATE PROC TR_MUCTIEU_SANXUAT2_GETBYMONTH
(
	@nam int,
	@thang int
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

		SELECT A.*, B.n_op AS tencongdoan 
		FROM tr_muctieu_sanxuat2 A
			INNER JOIN trtb_m_op B ON A.mabophan = B.c_op
		WHERE nam = @nam AND thang = @thang

	END TRY
	BEGIN CATCH
		-- Xử lý lỗi
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
	END CATCH
END

