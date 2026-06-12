-- PARAMS:
-- @formName nvarchar
-- @mabophan nvarchar


CREATE   PROCEDURE [dbo].[TR_GRIDVIEW_COLUMN_GETALL2](@formName nvarchar(200), @mabophan nvarchar(max))
AS
BEGIN
	SELECT * FROM tr_gridview_column
	WHERE formName = @formName 
		AND mabophan IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@mabophan, ','))
	ORDER BY visibleIndex
END

