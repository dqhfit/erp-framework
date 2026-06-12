-- PARAMS:
-- @date date
-- @congdoan nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar


CREATE PROC [dbo].[TR_MUCTIEU_SANXUAT_GETALL4]
(
	@date date,
	@congdoan nvarchar(50),
	@ngaytao datetime,
	@nguoitao nvarchar(50),
	@ngaysua datetime,
	@nguoisua nvarchar(50)
)
AS
BEGIN
	DECLARE @Month INT = MONTH(@date);
	DECLARE @Year INT = YEAR(@date);

	WITH DateList AS (
		-- Ngày đầu tiên của tháng
		SELECT DATEFROMPARTS(@Year, @Month, 1) AS DateValue
		UNION ALL
		-- Thêm từng ngày tiếp theo
		SELECT DATEADD(DAY, 1, DateValue)
		FROM DateList
		WHERE DATEADD(DAY, 1, DateValue) < DATEADD(MONTH, 1, DATEFROMPARTS(@Year, @Month, 1))
	)
	SELECT 
		DateValue,
		DAY(DateValue) AS DayNumber
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
		IF NOT EXISTS (SELECT 1 FROM tr_muctieu_sanxuat WHERE macongdoan = @congdoan AND ngaythang = @DateValue)
		BEGIN
			INSERT INTO tr_muctieu_sanxuat(ngaythang, macongdoan, ngaytao, nguoitao, ngaysua, nguoisua)
			VALUES (@DateValue, @congdoan, @ngaytao, @nguoitao, @ngaysua, @nguoisua)
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
	FROM tr_muctieu_sanxuat A
		INNER JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE YEAR(A.ngaythang) = @Year AND MONTH(A.ngaythang) = @Month
		AND A.macongdoan = @congdoan

	DROP TABLE #CACNGAYTRONGTHANG;
END

