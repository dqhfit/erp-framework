-- PARAMS:
-- @nam int
-- @thang int
-- @macongdoan nvarchar


CREATE PROC [dbo].[TR_MUCTIEU_SANXUAT2_CHITIET_CREATE]
(
	@nam int,
	@thang int,
	@macongdoan nvarchar(50)
)
AS
BEGIN
	WITH DateList AS (
		-- Ngày đầu tiên của tháng
		SELECT DATEFROMPARTS(@nam, @thang, 1) AS DateValue
		UNION ALL
		-- Thêm từng ngày tiếp theo
		SELECT DATEADD(DAY, 1, DateValue)
		FROM DateList
		WHERE DATEADD(DAY, 1, DateValue) < DATEADD(MONTH, 1, DATEFROMPARTS(@nam, @thang, 1))
	)
	SELECT DateValue, DAY(DateValue) AS DayNumber
	INTO #CACNGAYTRONGTHANG
	FROM DateList
	ORDER BY DateValue;

	DECLARE @DateValue DATE;
	DECLARE CUR CURSOR LOCAL FOR
		SELECT DateValue FROM #CACNGAYTRONGTHANG
	OPEN CUR;
	FETCH NEXT FROM CUR INTO @DateValue;
	WHILE @@FETCH_STATUS = 0
	BEGIN
		IF NOT EXISTS (SELECT 1 FROM tr_muctieu_sanxuat2_chitiet WHERE macongdoan = @macongdoan AND ngaythang = @DateValue)
		BEGIN
			INSERT INTO tr_muctieu_sanxuat2_chitiet(macongdoan, ngaythang) VALUES (@macongdoan, @DateValue)
		END
		FETCH NEXT FROM CUR INTO @DateValue;
	END
	CLOSE CUR;
	DEALLOCATE CUR;

	SELECT A.*, B.n_op AS tencongdoan,
		CASE DATENAME(WEEKDAY, A.ngaythang) 
				WHEN 'Monday' THEN N'Thứ hai'
				WHEN 'Tuesday' THEN N'Thứ ba'
				WHEN 'Wednesday' THEN N'Thứ tư'
				WHEN 'Thursday' THEN N'Thứ năm'
				WHEN 'Friday' THEN N'Thứ sáu'
				WHEN 'Saturday' THEN N'Thứ bảy'
				WHEN 'Sunday' THEN N'Chủ nhật'
			END as day_name
	FROM tr_muctieu_sanxuat2_chitiet A
		INNER JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE YEAR(A.ngaythang) = @nam AND MONTH(A.ngaythang) = @thang
		AND A.macongdoan = @macongdoan
	ORDER BY A.ngaythang

	DROP TABLE #CACNGAYTRONGTHANG;
END

