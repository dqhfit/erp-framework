-- PARAMS:
-- @TUNGAY date
-- @DENNGAY date



CREATE   PROCEDURE TR_BAOCAO_FINAL_BAOCAOCHATLUONG
(
	@TUNGAY DATE,
	@DENNGAY DATE
)
AS
BEGIN
	SELECT DATEPART(WEEK, A.ngaykiemtra) AS sotuan,
		A.khachhang, A.hehang, A.po_khachhang, A.dexuat,
		CASE
			WHEN A.RefType = 2051 OR A.RefType = 2052 THEN N'x' ELSE NULL
		END AS ketqua_dat,
		CASE
			WHEN A.RefType = 2053 THEN N'x' ELSE NULL
		END AS ketqua_khongdat
	FROM tr_baocao_final A
	WHERE A.ngaykiemtra BETWEEN @TUNGAY AND @DENNGAY
	ORDER BY sotuan, khachhang, hehang
END
