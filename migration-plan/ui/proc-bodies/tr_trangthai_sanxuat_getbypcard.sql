-- PARAMS:
-- @pcard nvarchar
-- @congdoan nvarchar


CREATE PROC TR_TRANGTHAI_SANXUAT_GETBYPCARD
(
	@pcard nvarchar(50),
	@congdoan nvarchar(50)
)
AS
SELECT * FROM tr_trangthai_sanxuat
WHERE pcard = @pcard and congdoan = @congdoan


