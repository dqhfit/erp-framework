-- PARAMS:
-- @date date
-- @congdoan nvarchar


CREATE   PROC [dbo].[TR_MUCTIEU_SANXUAT_GETALL3]
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

	SELECT B.id, A.macongdoan, C.n_op AS tencongdoan, A.DateValue as ngaythang, B.muctieu, B.songuoi, B.sogio,
		CASE DATENAME(WEEKDAY, A.DateValue) 
			WHEN 'Monday' THEN N'Thứ hai'
			WHEN 'Tuesday' THEN N'Thứ ba'
			WHEN 'Wednesday' THEN N'Thứ tư'
			WHEN 'Thursday' THEN N'Thứ năm'
			WHEN 'Friday' THEN N'Thứ sáu'
			WHEN 'Saturday' THEN N'Thứ bảy'
			WHEN 'Sunday' THEN N'Chủ nhật'
		END as day_name, B.RowVer
	FROM DateRangeCTE A
		LEFT JOIN tr_muctieu_sanxuat B ON A.macongdoan = B.macongdoan AND A.DateValue = B.ngaythang
		LEFT JOIN trtb_m_op C ON B.macongdoan = C.c_op
	OPTION (MAXRECURSION 0);
END

