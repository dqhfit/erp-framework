-- PARAMS:
-- @khongtinhson bit
-- @id int

CREATE PROC TR_ORDER_DETAIL_SETKHONGTINHSON
(
	@khongtinhson bit,
	@id int
)
AS
BEGIN
	UPDATE tr_order_detail
	SET khongtinhson = @khongtinhson
	WHERE id = @id
END

