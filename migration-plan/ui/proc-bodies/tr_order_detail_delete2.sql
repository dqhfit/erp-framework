-- PARAMS:
-- @id int

CREATE PROC TR_ORDER_DETAIL_DELETE2
(
	@id int
)
AS
DELETE tr_order_detail
WHERE id = @id
