-- PARAMS:
-- @item_id uniqueidentifier
-- @image_id int


CREATE PROCEDURE [dbo].[TR_BAOCAO_FINAL_MUCKIEMTRA_DELETE2]
(
	@item_id uniqueidentifier,
	@image_id int
)
AS
BEGIN
	DELETE tr_baocao_final_hinhanh WHERE item_id = @item_id AND image_id = @image_id;
	IF NOT EXISTS (SELECT 1 FROM tr_baocao_final_hinhanh WHERE item_id = @item_id)
	BEGIN
		DELETE tr_baocao_final_muckiemtra WHERE item_id = @item_id;
	END
END

