-- PARAMS:
-- @id int

CREATE   PROCEDURE TR_SANPHAM_COMPONENTS_DELETEBYID
(
	@id int
)
AS
DELETE tr_sanpham_componentsWHERE id = @id
