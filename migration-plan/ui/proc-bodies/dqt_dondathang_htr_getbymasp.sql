-- PARAMS:
-- @maddh nvarchar
-- @masp nvarchar


CREATE PROC DQT_DONDATHANG_HTR_GETBYMASP
(
	@maddh nvarchar(200),
	@masp nvarchar(200)
)
AS

DECLARE @HTR NVARCHAR(50)

SELECT @HTR = mact
FROM tr_chitiet_hangtrang
WHERE masp = @masp

SELECT * FROM tr_dondathang_chitiet
WHERE maddh = @maddh AND chitiet = @HTR

