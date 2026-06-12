-- PARAMS:
-- @MADDH nvarchar


CREATE PROC GETVENDORBYMADDH(@MADDH NVARCHAR(200))
AS
SELECT DISTINCT mancc, tenncc
INTO #DONDATHANG
FROM tr_dondathang
WHERE maddh = @MADDH;

SELECT A.mancc, 
	ISNULL((SELECT TOP 1 vendor_name FROM tr_nhacc WHERE vendor_id = A.mancc), A.tenncc) AS tenncc,
	(SELECT TOP 1 [address] FROM tr_nhacc WHERE vendor_id = A.mancc) AS diachi,
	(SELECT TOP 1 phone FROM tr_nhacc WHERE vendor_id = A.mancc) AS dienthoai,
	(SELECT TOP 1 email FROM tr_nhacc WHERE vendor_id = A.mancc) AS email
FROM #DONDATHANG A

