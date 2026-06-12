-- PARAMS:
-- @loaidonhang nvarchar
-- @hoanthanh bit


CREATE PROC [dbo].[TR_LENHCAPPHAT_HEAD_GETLISTBYTYPE]
(
     @loaidonhang nvarchar(50),
	@hoanthanh bit
)
AS

SELECT * FROM tr_lenhcapphat_head
WHERE active = 1 
    AND hoanthanh  = @hoanthanh
    AND LoaiDonHang = @loaidonhang
ORDER BY ngaytao DESC


