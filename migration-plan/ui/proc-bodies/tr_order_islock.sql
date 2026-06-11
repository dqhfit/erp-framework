-- PARAMS:
-- @IsLock bit

CREATE PROC [dbo].[TR_ORDER_ISLOCK](@IsLock BIT)
AS
BEGIN
	SELECT * 
	FROM tr_order WITH(NOLOCK)
	WHERE f_cancelled = 'N'
		AND choduyet = 1
		AND IsLock = @IsLock
	ORDER BY order_number
END

