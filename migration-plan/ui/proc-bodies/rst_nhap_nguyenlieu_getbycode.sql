-- PARAMS:
-- @sophieu nvarchar

----------RST_NHAP_NGUYENLIEU_GETBYCODE
CREATE PROCEDURE RST_NHAP_NGUYENLIEU_GETBYCODE(@sophieu nvarchar(50))
AS
SELECT * FROM rst_nhap_nguyenlieu
WHERE sophieu = @sophieu
