-- PARAMS:
-- @LoaiDonHang nvarchar


CREATE PROC [dbo].[TR_LENHCAPPHAT_HEAD_GETBYKHO](@LoaiDonHang NVARCHAR(100))
AS
BEGIN
	SELECT * 
	FROM tr_lenhcapphat_head A
	WHERE A.active = 1 AND hoanthanh = 0
		AND A.LoaiDonHang = @LoaiDonHang
END

