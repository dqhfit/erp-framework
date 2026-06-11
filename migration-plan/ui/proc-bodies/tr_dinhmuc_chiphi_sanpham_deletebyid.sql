-- PARAMS:
-- @id uniqueidentifier

CREATE PROCEDURE TR_DINHMUC_CHIPHI_SANPHAM_DELETEBYID(@id uniqueidentifier)
AS
BEGIN
    DELETE tr_dinhmuc_chiphi_sanpham
    WHERE id = @id
END
