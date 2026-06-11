-- PARAMS:
-- @id int

CREATE PROC [dbo].[TR_ORDER_EXAMPLE_DETAIL_DELETE2]
(
	@id int
)
AS
DELETE tr_order_example_detail
WHERE id = @id
