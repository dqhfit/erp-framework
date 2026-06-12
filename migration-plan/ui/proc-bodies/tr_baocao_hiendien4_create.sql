-- PARAMS:
-- @date date
-- @congdoan nvarchar


CREATE PROC [dbo].[TR_BAOCAO_HIENDIEN4_CREATE]
(
	@date date,
	@congdoan nvarchar(50)
)
AS
BEGIN
	DECLARE @start_date date = DATEFROMPARTS(YEAR(@date), MONTH(@date), 1);
	DECLARE @end_date date = EOMONTH(@date);

	WITH DateRangeCTE AS 
	(
		-- Anchor member
		SELECT @congdoan AS macongdoan, @start_date AS DateValue
		UNION ALL
		-- Recursive member
		SELECT @congdoan AS macongdoan, DATEADD(DAY, 1, DateValue)
		FROM DateRangeCTE
		WHERE DATEADD(DAY, 1, DateValue) <= @end_date
	)

	SELECT B.id, A.macongdoan, A.DateValue as ngaythang, B.songuoi_hanhchanh, B.songuoi_tangca,
	CASE DATENAME(WEEKDAY, A.DateValue) 
		WHEN 'Monday' THEN N'Thứ hai'
		WHEN 'Tuesday' THEN N'Thứ ba'
		WHEN 'Wednesday' THEN N'Thứ tư'
		WHEN 'Thursday' THEN N'Thứ năm'
		WHEN 'Friday' THEN N'Thứ sáu'
		WHEN 'Saturday' THEN N'Thứ bảy'
		WHEN 'Sunday' THEN N'Chủ nhật'
	END as day_name
	FROM DateRangeCTE A
		LEFT JOIN tr_baocao_hiendien4 B ON A.macongdoan = B.macongdoan AND A.DateValue = B.ngaythang
	OPTION (MAXRECURSION 0);
END

