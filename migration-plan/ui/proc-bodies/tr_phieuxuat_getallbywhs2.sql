-- PARAMS:
-- @makho nvarchar
-- @tungay date
-- @denngay date

CREATE PROC [dbo].[TR_PHIEUXUAT_GETALLBYWHS2]
(
	@makho nvarchar(MAX),
	@tungay date,
	@denngay date
)
AS
BEGIN
	SELECT a.*, COALESCE(a.phieuyeucau, a.donhang, a.lenhcapphat) as xuattheo,
		B.RefTypeName AS loaiphieuxuat,
		C.RefTypeName AS mucdichxuat,
		D.[description] AS tenkho
	FROM tr_phieuxuat a
		LEFT JOIN tr_reftype B ON A.RefType = B.RefType
		LEFT JOIN tr_reftype C ON A.mucdich = C.RefType
		LEFT JOIN tr_site D ON A.makho = D.[name]
	WHERE a.active = 1 
		AND A.makho IN (SELECT LTRIM(RTRIM([value])) FROM STRING_SPLIT(@makho, ','))
		AND CONVERT(date, a.ngaytao) BETWEEN @tungay AND @denngay
END
