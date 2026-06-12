-- PARAMS:
-- @nguyenlieu nvarchar


CREATE PROC TR_NHOM_NGUYENLIEU_SEARCH(@nguyenlieu NVARCHAR(200))
AS
SELECT *
FROM tr_nhom_nguyenlieu 
WHERE nguyenlieu LIKE CONCAT(@nguyenlieu, '%')
