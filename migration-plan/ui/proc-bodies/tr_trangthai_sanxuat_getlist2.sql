-- PARAMS:
-- @congdoan nvarchar
-- @ngaythang date


CREATE PROC TR_TRANGTHAI_SANXUAT_GETLIST2
(
    @congdoan nvarchar(50),
    @ngaythang date
)
AS
SELECT * FROM tr_trangthai_sanxuat
WHERE ngaythang = @ngaythang
    AND congdoan = @congdoan
