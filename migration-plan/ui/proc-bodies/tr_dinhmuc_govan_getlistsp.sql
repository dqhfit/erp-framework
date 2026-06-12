-- PARAMS:
-- (khong co tham so)


CREATE PROC TR_DINHMUC_GOVAN_GETLISTSP
AS
SELECT B.masp, B.tensp, B.hehang
FROM tr_dinhmuc_govan A 
    INNER JOIN tr_sanpham B ON A.masp = B.masp
WHERE B.active = 1
GROUP BY B.masp, B.tensp, B.hehang
