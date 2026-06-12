-- PARAMS:
-- @report_id nvarchar


CREATE PROC TR_BIEUMAU_FRIDAY_GETBYREPORTID(@report_id nvarchar(200))
AS
BEGIN
	SELECT TOP (1) * FROM tr_bieumau_friday
	WHERE report_id = @report_id AND actived = 1
	ORDER BY create_date DESC
END

