-- PARAMS:
-- (khong co tham so)


CREATE PROC MES_QUYTRINH_SANPHAM_GETCATEGORY
AS
SELECT A.* 
FROM tr_sanpham_nhamay A
WHERE A.active = 1
	AND EXISTS (SELECT masp FROM mes_quytrinh_sanpham B WHERE A.masp_nhamay = B.masp)

