-- PARAMS:
-- @active bit
-- @trangthai int
-- @tiendo bit


CREATE PROC [dbo].[TR_LENHCAPPHAT_HEAD_GETBYACTIVE]
(
	@active BIT = 1, 
	@trangthai int,
	@tiendo bit = 0
)
AS
IF(@trangthai = 1)--ĐÃ DUYỆT
BEGIN
	SELECT * FROM tr_lenhcapphat_head
	WHERE active = @active 
		AND hoanthanh = @tiendo
		AND nguoiduyet is not null 
		AND ngayduyet is not null
	ORDER BY ngaytao DESC
END
ELSE IF(@trangthai = 0)--CHƯA DUYỆT
BEGIN
	SELECT * FROM tr_lenhcapphat_head
	WHERE active = @active 
		AND hoanthanh  = @tiendo
		AND nguoiduyet is null 
		AND ngayduyet is null
	ORDER BY ngaytao DESC
END





