-- PARAMS:
-- @masp_nhamay nvarchar
-- @mausac nvarchar
-- @loaidinhmuc nvarchar


CREATE PROC [dbo].[TR_DINHMUC_LOCK_GET2]
(
	@masp_nhamay nvarchar(200),
	@mausac nvarchar(50),
	@loaidinhmuc nvarchar(50)
)
AS
DECLARE @masp nvarchar(200)

SELECT @masp = masp
FROM tr_sanpham
WHERE masp_nhamay = @masp_nhamay AND mausac = @mausac

SELECT * FROM tr_dinhmuc_lock
WHERE masp = @masp AND loaidinhmuc = @loaidinhmuc

