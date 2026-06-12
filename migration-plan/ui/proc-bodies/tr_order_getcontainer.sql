-- PARAMS:
-- (khong co tham so)

CREATE PROCEDURE [dbo].[TR_ORDER_GETCONTAINER]
AS
BEGIN
	SELECT order_number, [range], cont_qty, customer, Finished
	FROM tr_order WITH(NOLOCK)
	WHERE f_cancelled = 'N' AND choduyet = 1
	UNION ALL
	SELECT donhang, NULL, NULL, makhachhang, hoanthanh
	FROM tr_order_replacement WITH(NOLOCK)
	WHERE active = 1
END
