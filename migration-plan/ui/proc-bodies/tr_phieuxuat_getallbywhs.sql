-- PARAMS:
-- @makho nvarchar

CREATE PROC [dbo].[TR_PHIEUXUAT_GETALLBYWHS](@makho nvarchar(50))
AS
BEGIN
	SELECT a.*, COALESCE(a.phieuyeucau, a.donhang, a.lenhcapphat) as xuattheo,
		B.RefTypeName AS loaiphieuxuat,
		C.RefTypeName AS mucdichxuat
	FROM tr_phieuxuat a
		LEFT JOIN tr_reftype B ON A.RefType = B.RefType
		LEFT JOIN tr_reftype C ON A.mucdich = C.RefType
	WHERE a.active = 1 AND A.makho = @makho --AND YEAR(A.ngaytao) = YEAR(GETDATE())

END

