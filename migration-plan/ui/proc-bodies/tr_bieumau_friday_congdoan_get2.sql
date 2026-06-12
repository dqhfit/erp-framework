-- PARAMS:
-- @report_id nvarchar
-- @macongdoan nvarchar


CREATE   PROC [dbo].[TR_BIEUMAU_FRIDAY_CONGDOAN_GET2]
(
	@report_id nvarchar(50),
	@macongdoan nvarchar(50)
)
AS
BEGIN
	SELECT B.* 
	FROM tr_bieumau_friday A
		INNER JOIN tr_bieumau_friday_congdoan B ON A.id = B.id_bieumau
	WHERE A.report_id = @report_id AND macongdoan = @macongdoan
END

