-- PARAMS:
-- @trangthai nvarchar
-- @tungay date
-- @denngay date


CREATE PROCEDURE TR_PHIEUGIAO_THANHPHAM_GETBYDATE
(
	@trangthai nvarchar(200),
	@tungay date,
	@denngay date
)
AS
BEGIN
	SELECT A.*, B.RefTypeName AS trangthai
	FROM tr_phieugiao_thanhpham A
		LEFT JOIN tr_reftype B ON A.reftype_id = B.RefType
	WHERE A.reftype_id IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@trangthai, ','))
		AND A.ngaygiao BETWEEN @tungay AND @denngay
END

