-- PARAMS:
-- @active bit

CREATE PROCEDURE TR_SANPHAM_NHAMAY_GETBYSTATUS(@active bit)
AS
SELECT * FROM tr_sanpham_nhamay
WHERE active = @active
