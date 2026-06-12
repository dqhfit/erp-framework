-- PARAMS:
-- @makho nvarchar


CREATE PROCEDURE [dbo].[TR_PHIEUKIEMKE_CHITIET_NEWDATA](@makho nvarchar(50))
AS
BEGIN
	SELECT A.BatchNo AS malo, B.mavt AS mact, B.mota, B.quycach, B.mausac,
		A.Quantity AS soluong_hethong,
		NULL AS soluong_thucte,
		B.dvt, B.nhom
	FROM StockBalances A
		INNER JOIN tr_material B ON A.MaterialCode = B.mavt
	WHERE A.WarehouseCode = @makho AND A.Quantity > 0
	ORDER BY B.nhom, B.mota
END

